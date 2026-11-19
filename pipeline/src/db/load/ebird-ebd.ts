/**
 * eBird Basic Dataset (EBD) for India: the observation file and the sampling event file,
 * tab-separated, as downloaded from ebird.org/data/download (unzip or untar them first).
 * Loads the derived database:
 *   ebd_checklist    one row per checklist, with effort, completeness and group id
 *   ebd_observation  one row per species per checklist (subspecies rolled up to species)
 *   ebd_unmatched    names that aren't a species on the India checklist (spuh, hybrids,
 *                    escapes, unconfirmed species), counted for review
 *
 *   bun run db:load ebird-ebd ebird-ebd-<relMon-YYYY>
 *
 * Raw eBird records are never published (eBird terms); only derived results are.
 */
import { basename } from "node:path";
import { Db, ident, lit } from "../duck.ts";
import { listFiles, type ReleaseEntry } from "../manifest.ts";
import { dbFile, type Paths } from "../paths.ts";
import { cell25Sql, LoadError, week48Sql } from "./common.ts";
import type { StepLog } from "./india-checklist.ts";

/** Each needed column and the names eBird has used for it across releases. */
const SAMPLING_COLUMNS: Record<string, string[]> = {
  list: ["SAMPLING EVENT IDENTIFIER"],
  group: ["GROUP IDENTIFIER"],
  observer: ["OBSERVER ID"],
  date: ["OBSERVATION DATE"],
  time: ["TIME OBSERVATIONS STARTED"],
  state: ["STATE CODE"],
  county: ["COUNTY CODE"],
  lat: ["LATITUDE"],
  lon: ["LONGITUDE"],
  locality: ["LOCALITY ID"],
  localityType: ["LOCALITY TYPE"],
  protocol: ["PROTOCOL TYPE", "OBSERVATION TYPE", "PROTOCOL NAME"],
  duration: ["DURATION MINUTES"],
  distance: ["EFFORT DISTANCE KM"],
  observers: ["NUMBER OBSERVERS"],
  complete: ["ALL SPECIES REPORTED"],
};
const OBSERVATION_COLUMNS: Record<string, string[]> = {
  list: ["SAMPLING EVENT IDENTIFIER"],
  category: ["CATEGORY"],
  sci: ["SCIENTIFIC NAME"],
  count: ["OBSERVATION COUNT"],
  approved: ["APPROVED"],
};
const OPTIONAL_OBSERVATION_COLUMNS: Record<string, string[]> = {
  concept: ["TAXON CONCEPT ID"],
  exotic: ["EXOTIC CODE"],
};

/** Categories that stand for one species: the species itself or a named form of it. */
const SPECIES_LEVEL = "('species', 'issf', 'form', 'intergrade')";

const readTsv = (file: string) =>
  `read_csv(${lit(file)}, delim = '\t', header = true, quote = '', escape = '', all_varchar = true, null_padding = true)`;

function pick(
  file: string,
  have: string[],
  want: Record<string, string[]>,
  optional = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, names] of Object.entries(want)) {
    const found = names.find((n) => have.includes(n));
    if (found) out[key] = ident(found);
    else if (!optional) missing.push(names.join(" / "));
  }
  if (missing.length) {
    throw new LoadError(`${basename(file)} is missing columns: ${missing.join(", ")}`);
  }
  return out;
}

export async function loadEbd(p: Paths, dir: string, r: ReleaseEntry, log: StepLog): Promise<void> {
  const txt = listFiles(dir).filter(
    (f) => /\.txt(\.gz)?$/.test(f) && basename(f).startsWith("ebd_"),
  );
  const sampling = txt.filter((f) => basename(f).includes("sampling"));
  const observations = txt.filter((f) => !basename(f).includes("sampling"));
  if (sampling.length !== 1 || observations.length !== 1) {
    throw new LoadError(
      `${dir} should hold one ebd_..._sampling_....txt and one other ebd_....txt file; found ${txt.map((f) => basename(f)).join(", ") || "none"}`,
    );
  }
  const [sFile, oFile] = [sampling[0] as string, observations[0] as string];
  const rel = lit(r.release_id);

  const db = await Db.open(dbFile(p, "derived"));
  try {
    await db.run(`ATTACH ${lit(dbFile(p, "base"))} AS base (READ_ONLY)`);
    const header = async (f: string) =>
      (await db.rows<{ column_name: string }>(`DESCRIBE SELECT * FROM ${readTsv(f)}`)).map(
        (c) => c.column_name,
      );
    const sh = await header(sFile);
    const oh = await header(oFile);
    const s = pick(sFile, sh, SAMPLING_COLUMNS);
    const o = {
      ...pick(oFile, oh, OBSERVATION_COLUMNS),
      ...pick(oFile, oh, OPTIONAL_OBSERVATION_COLUMNS, true),
    };
    const t = (expr: string | undefined) => (expr ? `NULLIF(trim(${expr}), '')` : "NULL");

    await db.run("BEGIN TRANSACTION");
    try {
      for (const table of ["ebd_observation", "ebd_checklist", "ebd_unmatched"]) {
        await db.run(`DELETE FROM ${table} WHERE release_id = ${rel}`);
      }

      // ---- checklists
      const t0 = performance.now();
      await db.run(`
        CREATE OR REPLACE TEMP TABLE s_raw AS
        SELECT ${t(s.list)} AS list_id, ${t(s.group)} AS group_id, ${t(s.observer)} AS observer_id,
               TRY_CAST(${t(s.date)} AS DATE) AS obs_date, ${t(s.time)} AS time_started,
               ${t(s.state)} AS state_code, ${t(s.county)} AS county_code,
               TRY_CAST(${t(s.lat)} AS DOUBLE) AS lat, TRY_CAST(${t(s.lon)} AS DOUBLE) AS lon,
               ${t(s.locality)} AS locality_id, ${t(s.localityType)} AS locality_type,
               ${t(s.protocol)} AS protocol,
               CAST(TRY_CAST(${t(s.duration)} AS DOUBLE) AS INTEGER) AS duration_min,
               TRY_CAST(${t(s.distance)} AS DOUBLE) AS distance_km,
               CAST(TRY_CAST(${t(s.observers)} AS DOUBLE) AS SMALLINT) AS n_observers,
               ${t(s.complete)} = '1' AS complete
        FROM ${readTsv(sFile)}`);
      const sTotal = await db.count("SELECT count(*) FROM s_raw");
      const sBad = await db.count(`
        SELECT count(*) FROM s_raw WHERE list_id IS NULL OR obs_date IS NULL
          OR state_code NOT IN (SELECT scope_code FROM base.scope WHERE kind = 'state')`);
      const sDup = await db.count(
        "SELECT count(*) FROM (SELECT list_id FROM s_raw GROUP BY 1 HAVING count(*) > 1)",
      );
      if (sDup) throw new LoadError(`${sDup} checklist ids appear twice in ${basename(sFile)}`);
      await db.run(`
        INSERT INTO ebd_checklist
        SELECT list_id, group_id, observer_id, obs_date, CAST(year(obs_date) AS SMALLINT),
               CAST(${week48Sql("obs_date")} AS SMALLINT), time_started, state_code,
               CASE WHEN county_code IN (SELECT scope_code FROM base.scope) THEN county_code ELSE state_code END,
               lat, lon, ${cell25Sql("lat", "lon")}, locality_id, locality_type, protocol,
               duration_min, distance_km, n_observers, complete, ${rel}
        FROM s_raw
        WHERE list_id IS NOT NULL AND obs_date IS NOT NULL
          AND state_code IN (SELECT scope_code FROM base.scope WHERE kind = 'state')`);
      log(
        `  checklists: ${sTotal - sBad} loaded, ${sBad} skipped (no id, date or known state) [${Math.round((performance.now() - t0) / 1000)} s]`,
      );

      // ---- observations, matched to our species
      const t1 = performance.now();
      await db.run(`
        CREATE OR REPLACE TEMP TABLE o_raw AS
        SELECT ${t(o.list)} AS list_id, ${t(o.category)} AS category, ${t(o.sci)} AS sci_name,
               ${t(o.count)} AS how_many, ${t(o.approved)} = '1' AS approved,
               ${t(o.concept)} AS concept, ${t(o.exotic)} AS exotic
        FROM ${readTsv(oFile)}`);
      // By eBird 2025 name, then by Avibase concept id (for later taxonomy versions)
      await db.run(`
        CREATE OR REPLACE TEMP TABLE o_match AS
        SELECT o.*, coalesce(n.taxon_id, x.taxon_id) AS taxon_id
        FROM o_raw o
        LEFT JOIN base.taxon_name n ON n.authority = 'ebird-2025' AND n.sci_name = o.sci_name
          AND o.category IN ${SPECIES_LEVEL}
        LEFT JOIN base.taxon_xref x ON x.system = 'avibase' AND lower(x.external_id) = lower(o.concept)
          AND o.category = 'species'`);
      await db.run(`
        INSERT INTO ebd_observation
        SELECT list_id, taxon_id,
               CASE WHEN bool_or(how_many = 'X' OR TRY_CAST(how_many AS BIGINT) IS NULL) THEN NULL
                    ELSE CAST(sum(TRY_CAST(how_many AS BIGINT)) AS INTEGER) END,
               bool_or(approved), ${rel}
        FROM o_match
        WHERE taxon_id IS NOT NULL AND list_id IN (SELECT list_id FROM ebd_checklist WHERE release_id = ${rel})
        GROUP BY list_id, taxon_id`);
      await db.run(`
        INSERT INTO ebd_unmatched
        SELECT ${rel}, coalesce(sci_name, ''), coalesce(category, ''), coalesce(exotic, ''), count(*)
        FROM o_match WHERE taxon_id IS NULL GROUP BY 2, 3, 4`);
      const oTotal = await db.count("SELECT count(*) FROM o_raw");
      const oUnmatched = await db.count("SELECT count(*) FROM o_match WHERE taxon_id IS NULL");
      const oOrphan = await db.count(`
        SELECT count(*) FROM o_match WHERE taxon_id IS NOT NULL
          AND list_id NOT IN (SELECT list_id FROM ebd_checklist WHERE release_id = ${rel})`);
      const oLoaded = await db.count(
        `SELECT count(*) FROM ebd_observation WHERE release_id = ${rel}`,
      );
      log(
        `  observations: ${oTotal} rows -> ${oLoaded} species-on-checklist rows; ${oUnmatched} not a checklist species, ${oOrphan} on unknown checklists [${Math.round((performance.now() - t1) / 1000)} s]`,
      );
      const topUnmatched = await db.rows<{ sci_name: string; category: string; n: number }>(`
        SELECT sci_name, category, n_rows::INTEGER AS n FROM ebd_unmatched
        WHERE release_id = ${rel} AND category IN ${SPECIES_LEVEL} ORDER BY n_rows DESC LIMIT 8`);
      for (const u of topUnmatched)
        log(`    not on the India checklist: ${u.sci_name} (${u.n} rows)`);

      await db.run(`
        INSERT OR REPLACE INTO source_load (release_id, source_id, file_name, file_sha256, loaded_at, notes)
        VALUES (${rel}, ${lit(r.source_id)}, ${lit(`${basename(oFile)}, ${basename(sFile)}`)},
                ${r.sha256 ? lit(r.sha256) : "NULL"}, current_timestamp::TIMESTAMP, ${r.notes ? lit(r.notes) : "NULL"})`);
      await db.run("COMMIT");
    } catch (e) {
      await db.run("ROLLBACK");
      throw e;
    }
  } finally {
    db.close();
  }
}
