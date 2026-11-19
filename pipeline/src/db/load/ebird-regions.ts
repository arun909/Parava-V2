/**
 * eBird reference data fetched through the API (spike/ebird/fetch-reference.ts):
 *  - base: checks eBird's 37 states against our scopes and adds its districts as scopes
 *  - derived: every hotspot, with its district, grid cell and all-time counts
 */
import { join } from "node:path";
import { Db, lit } from "../duck.ts";
import type { ReleaseEntry } from "../manifest.ts";
import { dbFile, type Paths } from "../paths.ts";
import { cell25Sql, LoadError } from "./common.ts";
import type { StepLog } from "./india-checklist.ts";

/** Base part: runs inside the base release transaction. */
export async function loadEbirdDistricts(
  db: Db,
  dir: string,
  _r: ReleaseEntry,
  log: StepLog,
): Promise<void> {
  await db.run(
    `CREATE OR REPLACE TEMP TABLE e_state AS SELECT code, name FROM read_json(${lit(join(dir, "states.json"))})`,
  );
  const stateDiff = await db.rows<{ code: string; side: string }>(`
    SELECT code, 'eBird only' AS side FROM e_state WHERE code NOT IN (SELECT scope_code FROM scope WHERE kind = 'state')
    UNION ALL
    SELECT scope_code, 'ours only' FROM scope WHERE kind = 'state' AND scope_code NOT IN (SELECT code FROM e_state)`);
  if (stateDiff.length) {
    throw new LoadError(`state codes differ from eBird: ${JSON.stringify(stateDiff)}`);
  }

  await db.run(
    `CREATE OR REPLACE TEMP TABLE e_district AS
     SELECT code, name, regexp_extract(code, '^([A-Z]+-[A-Z]+)-', 1) AS parent
     FROM read_json(${lit(join(dir, "districts.json"))})`,
  );
  const orphans = await db.rows(
    "SELECT code FROM e_district WHERE parent NOT IN (SELECT scope_code FROM scope WHERE kind = 'state')",
  );
  if (orphans.length) {
    throw new LoadError(`districts with an unknown state: ${JSON.stringify(orphans.slice(0, 10))}`);
  }
  // Scopes are never deleted or renamed in place (they're referenced); only new ones are added
  const added = await db.count(
    "SELECT count(*) FROM e_district WHERE code NOT IN (SELECT scope_code FROM scope)",
  );
  await db.run(`
    INSERT INTO scope (scope_code, kind, parent_code, name_en)
    SELECT code, 'district', parent, name FROM e_district
    WHERE code NOT IN (SELECT scope_code FROM scope)`);
  const renamed = await db.rows(`
    SELECT s.scope_code, s.name_en, d.name FROM scope s JOIN e_district d ON d.code = s.scope_code
    WHERE s.name_en <> d.name`);
  const gone = await db.rows(`
    SELECT scope_code FROM scope WHERE kind = 'district' AND scope_code NOT IN (SELECT code FROM e_district)`);
  log(`  37 states match eBird; ${added} districts added`);
  if (renamed.length)
    log(`  note: ${renamed.length} districts renamed by eBird (not changed here)`);
  if (gone.length) log(`  note: ${gone.length} districts no longer in eBird's list (kept)`);
}

/** Derived part: replaces the hotspot table. Run after the base load has committed. */
export async function loadHotspots(
  p: Paths,
  dir: string,
  r: ReleaseEntry,
  log: StepLog,
): Promise<void> {
  const db = await Db.open(dbFile(p, "derived"));
  try {
    await db.run(`ATTACH ${lit(dbFile(p, "base"))} AS base (READ_ONLY)`);
    const files = lit(join(dir, "hotspots", "*.json"));
    await db.run(`
      CREATE OR REPLACE TEMP TABLE e_hot AS
      SELECT * FROM read_json(${files}, format = 'array', columns = {
        locId: 'VARCHAR', locName: 'VARCHAR', subnational1Code: 'VARCHAR', subnational2Code: 'VARCHAR',
        lat: 'DOUBLE', lng: 'DOUBLE', latestObsDt: 'VARCHAR',
        numSpeciesAllTime: 'INTEGER', numChecklistsAllTime: 'INTEGER'})`);
    const dups = await db.count(
      "SELECT count(*) FROM (SELECT locId FROM e_hot GROUP BY 1 HAVING count(*) > 1)",
    );
    if (dups) throw new LoadError(`${dups} hotspot ids appear twice`);

    await db.run("BEGIN TRANSACTION");
    try {
      await db.run("DELETE FROM site");
      await db.run(`
        INSERT INTO site (site_id, name, lat, lon, scope_code, cell25, state_code,
          n_species_all_time, n_checklists_all_time, latest_obs_at, updated_at, release_id)
        SELECT h.locId, h.locName, h.lat, h.lng,
               CASE WHEN h.subnational2Code IN (SELECT scope_code FROM base.scope) THEN h.subnational2Code
                    ELSE h.subnational1Code END,
               ${cell25Sql("h.lat", "h.lng")}, h.subnational1Code,
               h.numSpeciesAllTime, h.numChecklistsAllTime, TRY_CAST(h.latestObsDt AS TIMESTAMP),
               current_timestamp::TIMESTAMP, ${lit(r.release_id)}
        FROM e_hot h`);
      const unplaced = await db.count(
        "SELECT count(*) FROM site WHERE scope_code NOT IN (SELECT scope_code FROM base.scope)",
      );
      if (unplaced) throw new LoadError(`${unplaced} hotspots are in no known state`);
      await db.run(`
        INSERT OR REPLACE INTO source_load (release_id, source_id, file_name, loaded_at, notes)
        VALUES (${lit(r.release_id)}, ${lit(r.source_id)}, ${lit(r.file ?? "")}, current_timestamp::TIMESTAMP,
                'hotspots')`);
      await db.run("COMMIT");
    } catch (e) {
      await db.run("ROLLBACK");
      throw e;
    }
    const n = await db.count("SELECT count(*) FROM site");
    const byDistrict = await db.count("SELECT count(*) FROM site WHERE scope_code LIKE 'IN-%-%'");
    log(`  ${n} hotspots (${byDistrict} placed in a district)`);
  } finally {
    db.close();
  }
}
