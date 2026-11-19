/**
 * AVONET 1.0 (DB4): body measurements and two ecology fields for every bird species.
 * Supplementary dataset 1, sheets AVONET2_eBird (eBird 2021 taxonomy) and AVONET1_BirdLife.
 *
 * Matching, best first, using only current names and IDs (never SoIB's old v7.1 names):
 *   1. eBird sheet by scientific name   2. eBird sheet by Avibase ID
 *   3. BirdLife sheet by scientific name  4. BirdLife sheet by Avibase ID
 * A species takes the best method that finds exactly one row. A row that would serve two of
 * our species (a species split since 2021) is used for neither: they're listed, not guessed.
 * Fails if fewer than 95% of active species match.
 */
import { type Db, ident, lit, nz } from "../duck.ts";
import type { ReleaseEntry } from "../manifest.ts";
import {
  blankOut,
  type ColumnKind,
  checkColumns,
  LoadError,
  stage,
  type Workbook,
} from "./common.ts";
import { requireColumns, type StepLog } from "./india-checklist.ts";

const SHEETS = [
  {
    sheet: "AVONET2_eBird",
    table: "stg_av_e",
    name: "Species2",
    avibase: "Avibase.ID2",
    tag: "ebird",
  },
  {
    sheet: "AVONET1_BirdLife",
    table: "stg_av_b",
    name: "Species1",
    avibase: "Avibase.ID1",
    tag: "birdlife",
  },
] as const;

/** species_morphology column <- AVONET column (mm, g) */
const MORPHOLOGY: Record<string, string> = {
  mass_g: "Mass",
  wing_mm: "Wing.Length",
  tail_mm: "Tail.Length",
  tarsus_mm: "Tarsus.Length",
  beak_culmen_mm: "Beak.Length_Culmen",
  beak_depth_mm: "Beak.Depth",
  beak_width_mm: "Beak.Width",
  hand_wing_index: "Hand-Wing.Index",
};

/** species_extra key <- [AVONET column, text or number] */
const EXTRAS: [string, string, "text" | "num"][] = [
  ["avonet_beak_nares_mm", "Beak.Length_Nares", "num"],
  ["avonet_kipps_mm", "Kipps.Distance", "num"],
  ["avonet_habitat", "Habitat", "text"],
  ["avonet_habitat_density", "Habitat.Density", "num"],
  ["avonet_migration", "Migration", "num"], // 1 sedentary, 2 partial, 3 migratory
  ["avonet_trophic_niche", "Trophic.Niche", "text"],
  ["avonet_mass_source", "Mass.Source", "text"],
  ["avonet_traits_inferred", "Inference", "text"],
];

const SPEC: Record<string, ColumnKind> = {
  ...Object.fromEntries(Object.values(MORPHOLOGY).map((c) => [c, { kind: "num" } as ColumnKind])),
  ...Object.fromEntries(
    EXTRAS.map(([, c, k]) => [c, (k === "num" ? { kind: "num" } : { kind: "text" }) as ColumnKind]),
  ),
  "Trophic.Level": { kind: "cat", scheme: "avonet-trophic-level" },
  "Primary.Lifestyle": { kind: "cat", scheme: "avonet-lifestyle" },
};

/** Names that are current (not SoIB's v7.1 list, which lumps since-split species). */
const CURRENT_AUTHORITIES = "('ebird-2025', 'india-v10.1', 'india-2025', 'avilist', 'bli-2025')";

export async function loadAvonet(
  db: Db,
  wb: Workbook,
  r: ReleaseEntry,
  raw: { dir: string } | null,
  log: StepLog,
): Promise<void> {
  const rel = lit(r.release_id);
  for (const s of SHEETS) {
    const st = await stage(db, wb, s.sheet, s.table, raw);
    requireColumns(s.sheet, st.columns, [s.name, s.avibase, ...Object.keys(SPEC)]);
    await blankOut(db, s.table, "NA");
    await checkColumns(db, s.table, SPEC);
    log(`  ${s.sheet}: ${st.rows} rows`);
  }

  // Every candidate match, with its priority
  const candidates = SHEETS.flatMap((s, i) => [
    `SELECT n.taxon_id, ${lit(s.tag)} AS sheet, a._row, ${i * 2 + 1} AS prio, ${lit(`${s.tag}-sheet:name`)} AS method
     FROM ${s.table} a JOIN taxon_name n ON n.sci_name = trim(a.${ident(s.name)})
     WHERE n.authority IN ${CURRENT_AUTHORITIES}`,
    `SELECT x.taxon_id, ${lit(s.tag)} AS sheet, a._row, ${i * 2 + 2} AS prio, ${lit(`${s.tag}-sheet:avibase`)} AS method
     FROM ${s.table} a JOIN taxon_xref x ON x.system = 'avibase' AND lower(x.external_id) = lower(trim(a.${ident(s.avibase)}))`,
  ]);
  await db.run(`
    CREATE OR REPLACE TEMP TABLE av_cand AS
    SELECT DISTINCT * FROM (${candidates.join("\nUNION ALL\n")})`);
  // Per species: the best priority that gives exactly one row
  await db.run(`
    CREATE OR REPLACE TEMP TABLE av_pick AS
    WITH per AS (
      SELECT taxon_id, prio, any_value(sheet) AS sheet, any_value(_row) AS _row,
             any_value(method) AS method, count(*) AS n
      FROM av_cand GROUP BY 1, 2)
    SELECT DISTINCT ON (taxon_id) taxon_id, sheet, _row, method
    FROM per WHERE n = 1 ORDER BY taxon_id, prio`);
  // A row picked by two species is a lumped row: use it for neither
  await db.run(`
    CREATE OR REPLACE TEMP TABLE av_shared AS
    SELECT p.taxon_id FROM av_pick p
    JOIN (SELECT sheet, _row FROM av_pick GROUP BY 1, 2 HAVING count(*) > 1) d USING (sheet, _row)`);
  await db.run("DELETE FROM av_pick WHERE taxon_id IN (SELECT taxon_id FROM av_shared)");

  const active = await db.count("SELECT count(*) FROM taxon WHERE state = 'active'");
  const matched = await db.count(
    "SELECT count(*) FROM av_pick WHERE taxon_id IN (SELECT taxon_id FROM taxon WHERE state = 'active')",
  );
  const unmatched = await db.rows<{ en_name: string; why: string }>(`
    SELECT n.en_name, CASE WHEN t.taxon_id IN (SELECT taxon_id FROM av_shared)
                           THEN 'one AVONET row covers two species' ELSE 'no match' END AS why
    FROM taxon t JOIN taxon_name n ON n.taxon_id = t.taxon_id AND n.authority = 'india-v10.1'
    WHERE t.state = 'active' AND t.taxon_id NOT IN (SELECT taxon_id FROM av_pick)
    ORDER BY t.sort_order`);
  log(`  matched ${matched} / ${active} species`);
  for (const u of unmatched) log(`    unmatched: ${u.en_name} (${u.why})`);
  if (matched < 0.95 * active) {
    throw new LoadError(`only ${matched} of ${active} species matched AVONET (need 95%)`);
  }

  // One staged table per sheet; write each species' values from the sheet it matched
  for (const s of SHEETS) {
    const from = `FROM av_pick p JOIN ${s.table} a USING (_row) WHERE p.sheet = ${lit(s.tag)}`;
    const cols = Object.keys(MORPHOLOGY);
    await db.run(`
      INSERT INTO species_morphology (release_id, taxon_id, ${cols.join(", ")})
      SELECT ${rel}, p.taxon_id, ${cols.map((c) => `TRY_CAST(${nz(MORPHOLOGY[c] as string, "a")} AS DOUBLE)`).join(", ")}
      ${from}`);
    await db.run(`
      INSERT INTO species_ecology (release_id, taxon_id, trophic_level, primary_lifestyle)
      SELECT ${rel}, p.taxon_id,
        (SELECT code FROM lookup WHERE scheme = 'avonet-trophic-level' AND label = trim(a."Trophic.Level")),
        (SELECT code FROM lookup WHERE scheme = 'avonet-lifestyle' AND label = trim(a."Primary.Lifestyle"))
      ${from}`);
    for (const [key, col, kind] of EXTRAS) {
      const v = `NULLIF(trim(a.${ident(col)}), '')`;
      await db.run(`
        INSERT INTO species_extra (release_id, taxon_id, key, value_text, value_num)
        SELECT ${rel}, p.taxon_id, ${lit(key)}, ${kind === "text" ? v : "NULL"}, ${kind === "num" ? `TRY_CAST(${v} AS DOUBLE)` : "NULL"}
        ${from} AND ${v} IS NOT NULL`);
    }
    await db.run(`
      INSERT INTO species_extra (release_id, taxon_id, key, value_text)
      SELECT ${rel}, p.taxon_id, 'avonet_match', p.method ${from}`);
  }
}
