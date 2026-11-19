/**
 * SoIB 2026 v0 workbook. Needs the India checklist backbone loaded first.
 * India sheet: names in five lists, Avibase IDs, species facts, national assessments,
 * and SoIB 2020 national assessments as their own release.
 * State and habitat sheets: one assessment row per species and scope.
 *
 * Species are matched only on India.Checklist.Scientific.Name.2025. The older
 * "Scientific Name" column (v7.1) is shared by split species and must never be used to match.
 */
import { type Db, ident, lit, nz } from "../duck.ts";
import type { ReleaseEntry } from "../manifest.ts";
import {
  attachTaxon,
  type ColumnKind,
  checkColumns,
  conv,
  LoadError,
  requireMatched,
  stage,
  type Workbook,
} from "./common.ts";
import { expectCount, requireColumns, type StepLog } from "./india-checklist.ts";

const KEY = "India.Checklist.Scientific.Name.2025";
const AUTH = "india-v10.1";

const SPECIES_SPEC: Record<string, ColumnKind> = {
  "English Name": { kind: "text" },
  "Scientific Name": { kind: "text" },
  "eBird.English.Name.2025": { kind: "text" },
  "eBird.Scientific.Name.2025": { kind: "text" },
  "BLI.Common.Name.2025": { kind: "text" },
  "BLI.Scientific.Name.2025": { kind: "text" },
  "India.Checklist.Common.Name.2025": { kind: "text" },
  [KEY]: { kind: "text" },
  Order: { kind: "text" },
  Family: { kind: "text" },
  "Breeding Activity Period": { kind: "cat", scheme: "activity" },
  "Non-breeding Activity Period": { kind: "cat", scheme: "activity" },
  "Diet Guild": { kind: "cat", scheme: "diet" },
  Endemicity: { kind: "cat", scheme: "endemicity" },
  "Endemic to India": { kind: "bool01" },
  "Endemic to Subcontinent": { kind: "bool01" },
  "Endemic to Himalaya": { kind: "bool01" },
  "Habitat Specialization": { kind: "cat", scheme: "habitat" },
  "Migratory Status within India": { kind: "cat", scheme: "migratory" },
  "Restricted to Islands": { kind: "bool01" },
  "IUCN Category": { kind: "cat", scheme: "iucn" },
  "WPA Schedule": { kind: "cat", scheme: "wpa" },
  "CITES Appendix": { kind: "cat", scheme: "cites" },
  "CMS Appendix": { kind: "cat", scheme: "cms" },
  "1% Population Threshold": { kind: "int" },
  "Generation Length": { kind: "num" },
  "Number of Subspecies": { kind: "int" },
  "Percent of Global Range": { kind: "num" },
  "India Checklist Sort Order": { kind: "int" },
  "Avilist English Name": { kind: "text" },
  "Avilist Scientific Name": { kind: "text" },
  "Avibase ID": { kind: "text" },
  "Selected for NRL": { kind: "one" },
};

/** assessment column <- [sheet column, how to read it]; missing sheet columns load as NULL. */
const ASSESS_2026: Record<string, [string, ColumnKind]> = {
  selected: ["Selected for SoIB", { kind: "bool01" }],
  selected_lt: ["Selected for Long-term Trend", { kind: "bool01" }],
  selected_cat: ["Selected for Current Annual Trend", { kind: "bool01" }],
  priority: ["SoIB 2023 Priority Status", { kind: "cat", scheme: "soib-priority-2023" }],
  lt_status: ["SoIB 2023 Long-term Trend Status", { kind: "cat", scheme: "soib-trend-2023" }],
  cat_status: ["SoIB 2023 Current Annual Trend Status", { kind: "cat", scheme: "soib-trend-2023" }],
  range_status: [
    "SoIB 2023 Distribution Range Size Status",
    { kind: "cat", scheme: "soib-range-2023" },
  ],
  lt_mean_pct: ["Long-term Trend Mean", { kind: "num" }],
  lt_lci_pct: ["Long-term Trend LCI", { kind: "num" }],
  lt_uci_pct: ["Long-term Trend UCI", { kind: "num" }],
  cat_mean_pct: ["Current Annual Trend Mean", { kind: "num" }],
  cat_lci_pct: ["Current Annual Trend LCI", { kind: "num" }],
  cat_uci_pct: ["Current Annual Trend UCI", { kind: "num" }],
  range_mean_km2: ["Distribution Range Size Mean", { kind: "num" }],
  range_lci_km2: ["Distribution Range Size LCI", { kind: "num" }],
  range_uci_km2: ["Distribution Range Size UCI", { kind: "num" }],
  is_key_species: ["State Where Species Key", { kind: "bool01" }],
  n_grids: ["Number of Grids", { kind: "int" }],
  coverage_pre2000_pct: ["Range Coverage (Pre-2000)", { kind: "num" }],
  coverage_current_pct: ["Range Coverage (Current)", { kind: "num" }],
  coverage_latest_pct: ["Range Coverage (2025)", { kind: "num" }],
  grid_coverage_mean: ["Grid Coverage Mean", { kind: "num" }],
  grid_coverage_ci: ["Grid Coverage CI", { kind: "num" }],
  decline_3gen_pct: ["Projected % Decline in 3 Generations", { kind: "num" }],
  regional_red_list: ["Regional Red List Category", { kind: "cat", scheme: "iucn" }],
};

const ASSESS_2020: Record<string, [string, ColumnKind]> = {
  priority: ["SoIB 2020 Concern Status", { kind: "cat", scheme: "soib-concern-2020" }],
  lt_status: ["SoIB 2020 Long-term Trend Status", { kind: "cat", scheme: "soib-trend-2020" }],
  cat_status: ["SoIB 2020 Current Annual Trend Status", { kind: "cat", scheme: "soib-trend-2020" }],
  range_status: [
    "SoIB 2020 Distribution Range Size Status",
    { kind: "cat", scheme: "soib-range-2020" },
  ],
};

/** Every column the workbook is known to carry; anything else stops the load. */
const KNOWN_COLUMNS = new Set([
  ...Object.keys(SPECIES_SPEC),
  ...Object.values(ASSESS_2026).map(([c]) => c),
  ...Object.values(ASSESS_2020).map(([c]) => c),
]);

const specOf = (m: Record<string, [string, ColumnKind]>, have: Set<string>) =>
  Object.fromEntries(Object.values(m).filter(([c]) => have.has(c)));

export async function loadSoib(
  db: Db,
  wb: Workbook,
  r: ReleaseEntry,
  companions: ReleaseEntry[],
  raw: { dir: string } | null,
  log: StepLog,
): Promise<void> {
  const rel = lit(r.release_id);
  const r2020 = companions.find((c) => c.release_id === "soib-2020");
  if (!r2020)
    throw new LoadError("sources.json: soib-2020 should be listed as columns-of soib-2026-v0");
  if (!(await db.count(`SELECT count(*) FROM taxon_name WHERE authority = ${lit(AUTH)}`))) {
    throw new LoadError(
      "load the India checklist first: db:load india-checklist india-checklist-v10.1",
    );
  }

  await stage(db, wb, "README", "stg_soib_readme", raw);

  // ---- India sheet ----
  const india = await stage(db, wb, "India", "stg_in", raw);
  requireColumns("India", india.columns, Object.keys(SPECIES_SPEC));
  requireKnown("India", india.columns);
  await checkColumns(db, "stg_in", {
    ...SPECIES_SPEC,
    ...specOf(ASSESS_2026, india.columns),
    ...specOf(ASSESS_2020, india.columns),
  });
  await requireMatched(db, "stg_in", KEY, AUTH);
  await attachTaxon(db, "stg_in", KEY, AUTH);
  log(`  India: ${india.rows} rows`);
  await expectCount(db, "SELECT count(*) FROM taxon", india.rows, "India sheet vs backbone");

  // The sheet must agree with the backbone on order, family and sort order
  const disagree = await db.rows(`
    SELECT s.${ident(KEY)} AS name, t.sort_order, ${nz("India Checklist Sort Order")} AS soib_sort,
           f.sci_name AS family, ${nz("Family")} AS soib_family, o.sci_name AS ord, ${nz("Order")} AS soib_order
    FROM stg_in s JOIN taxon t ON t.taxon_id = s._taxon
    JOIN taxon_family f ON f.family_id = t.family_id JOIN taxon_order o ON o.order_id = f.order_id
    WHERE t.sort_order <> ${conv("India Checklist Sort Order", { kind: "int" })}
       OR f.sci_name <> regexp_extract(${nz("Family")}, '^(\\S+)', 1)
       OR o.sci_name <> ${nz("Order")}
    LIMIT 20`);
  if (disagree.length) {
    throw new LoadError(
      `India sheet disagrees with the checklist backbone: ${JSON.stringify(disagree)}`,
    );
  }

  // Family English names: "Anatidae (Ducks, Geese, and Waterfowl)"
  const badFamily = await db.rows(
    `SELECT DISTINCT ${nz("Family")} AS f FROM stg_in WHERE NOT regexp_matches(${nz("Family")}, '^\\S+ \\(.+\\)$')`,
  );
  if (badFamily.length) {
    throw new LoadError(`Family not in "Name (English)" form: ${JSON.stringify(badFamily)}`);
  }
  await db.run(`
    UPDATE taxon_family SET en_name = x.en FROM (
      SELECT DISTINCT lower(regexp_extract(${nz("Family")}, '^(\\S+)', 1)) AS id,
             regexp_extract(${nz("Family")}, '^\\S+ \\((.+)\\)$', 1) AS en FROM stg_in) x
    WHERE taxon_family.family_id = x.id`);

  // Names in five lists. india-2025 is the checklist name as SoIB carries it.
  const names: [string, string, string][] = [
    ["soib-v7.1", "Scientific Name", "English Name"],
    ["india-2025", KEY, "India.Checklist.Common.Name.2025"],
    ["ebird-2025", "eBird.Scientific.Name.2025", "eBird.English.Name.2025"],
    ["bli-2025", "BLI.Scientific.Name.2025", "BLI.Common.Name.2025"],
    ["avilist", "Avilist Scientific Name", "Avilist English Name"],
  ];
  for (const [authority, sci, en] of names) {
    await db.run(`
      INSERT INTO taxon_name (taxon_id, authority, sci_name, en_name, release_id)
      SELECT _taxon, ${lit(authority)}, ${nz(sci)}, ${nz(en)}, ${rel} FROM stg_in
      WHERE ${nz(sci)} IS NOT NULL OR ${nz(en)} IS NOT NULL`);
  }

  await db.run(`
    INSERT INTO taxon_xref (taxon_id, system, external_id, release_id)
    SELECT _taxon, 'avibase', ${nz("Avibase ID")}, ${rel} FROM stg_in WHERE ${nz("Avibase ID")} IS NOT NULL`);

  const c = (col: string) => conv(col, SPECIES_SPEC[col] as ColumnKind);
  await db.run(`
    INSERT INTO species_india_status (release_id, taxon_id, migratory_status, endemicity,
      endemic_india, endemic_subcontinent, endemic_himalaya, island_only)
    SELECT ${rel}, _taxon, ${c("Migratory Status within India")}, ${c("Endemicity")},
      ${c("Endemic to India")}, ${c("Endemic to Subcontinent")}, ${c("Endemic to Himalaya")},
      ${c("Restricted to Islands")}
    FROM stg_in`);

  // "Resident & Altitudinal Migrant" -> two parts; "(Extirpated)" becomes a flag
  await db.run(`
    CREATE OR REPLACE TEMP TABLE stg_mig AS
    SELECT _taxon, trim(regexp_replace(part, '\\s*\\(Extirpated\\)', '')) AS part,
           contains(part, '(Extirpated)') AS extirpated
    FROM (SELECT _taxon, unnest(string_split(${nz("Migratory Status within India")}, ' & ')) AS part
          FROM stg_in WHERE ${nz("Migratory Status within India")} IS NOT NULL)`);
  const badParts = await db.rows(
    `SELECT DISTINCT part FROM stg_mig WHERE part NOT IN (SELECT label FROM lookup WHERE scheme = 'migratory-part')`,
  );
  if (badParts.length) {
    throw new LoadError(
      `migratory parts not in lookup 'migratory-part': ${JSON.stringify(badParts)}`,
    );
  }
  await db.run(`
    INSERT INTO species_migratory_part (release_id, taxon_id, part, extirpated)
    SELECT ${rel}, _taxon, (SELECT code FROM lookup WHERE scheme = 'migratory-part' AND label = part), extirpated
    FROM stg_mig`);

  await db.run(`
    INSERT INTO species_legal (release_id, taxon_id, iucn, wpa_schedule, cites, cms)
    SELECT ${rel}, _taxon, ${c("IUCN Category")}, ${c("WPA Schedule")}, ${c("CITES Appendix")}, ${c("CMS Appendix")}
    FROM stg_in`);

  await db.run(`
    INSERT INTO species_ecology (release_id, taxon_id, diet, habitat_spec, activity_breeding, activity_nonbreeding)
    SELECT ${rel}, _taxon, ${c("Diet Guild")}, ${c("Habitat Specialization")},
           ${c("Breeding Activity Period")}, ${c("Non-breeding Activity Period")}
    FROM stg_in`);

  await db.run(`
    INSERT INTO species_population (release_id, taxon_id, pct1_threshold, generation_years,
      n_subspecies_india, share_global_range_frac)
    SELECT ${rel}, _taxon, ${c("1% Population Threshold")}, ${c("Generation Length")},
           ${c("Number of Subspecies")}, ${c("Percent of Global Range")}
    FROM stg_in`);

  // Selected for NRL is 1 or blank; only the 1s are stored
  await db.run(`
    INSERT INTO species_extra (release_id, taxon_id, key, value_num)
    SELECT ${rel}, _taxon, 'selected_nrl', ${c("Selected for NRL")} FROM stg_in
    WHERE ${c("Selected for NRL")} IS NOT NULL`);

  await insertAssessments(db, "stg_in", india.columns, r.release_id, "IN", ASSESS_2026, null);
  await insertAssessments(
    db,
    "stg_in",
    india.columns,
    r2020.release_id,
    "IN",
    ASSESS_2020,
    Object.values(ASSESS_2020)
      .map(([col]) => `${nz(col)} IS NOT NULL`)
      .join(" OR "),
  );
  const n2020 = await db.count(
    `SELECT count(*) FROM assessment WHERE release_id = ${lit(r2020.release_id)}`,
  );
  log(`  India: ${n2020} SoIB 2020 assessments`);

  // ---- State and habitat sheets ----
  const sheets = await db.rows<{ alias: string; scope_code: string }>(
    `SELECT alias, scope_code FROM scope_alias WHERE source_id = 'soib' AND alias <> 'India' ORDER BY alias`,
  );
  for (const { alias, scope_code } of sheets) {
    const s = await stage(db, wb, alias, "stg_sheet", raw);
    requireColumns(alias, s.columns, [KEY]);
    requireKnown(alias, s.columns);
    await checkColumns(db, "stg_sheet", specOf(ASSESS_2026, s.columns));
    try {
      await requireMatched(db, "stg_sheet", KEY, AUTH);
    } catch (e) {
      throw new LoadError(`${alias}: ${(e as Error).message}`);
    }
    await attachTaxon(db, "stg_sheet", KEY, AUTH);
    await insertAssessments(
      db,
      "stg_sheet",
      s.columns,
      r.release_id,
      scope_code,
      ASSESS_2026,
      null,
    );
    await expectCount(
      db,
      `SELECT count(*) FROM assessment WHERE release_id = ${rel} AND scope_code = ${lit(scope_code)}`,
      s.rows,
      `${alias} (${scope_code})`,
    );
    log(`  ${alias} -> ${scope_code}: ${s.rows} rows`);
  }
}

function requireKnown(sheet: string, have: Set<string>): void {
  const unknown = [...have].filter((c) => !KNOWN_COLUMNS.has(c));
  if (unknown.length) {
    throw new LoadError(
      `sheet "${sheet}" has columns this loader doesn't know: ${unknown.join(", ")}`,
    );
  }
}

async function insertAssessments(
  db: Db,
  table: string,
  have: Set<string>,
  releaseId: string,
  scope: string,
  map: Record<string, [string, ColumnKind]>,
  where: string | null,
): Promise<void> {
  const targets = Object.keys(map);
  const exprs = Object.values(map).map(([col, k]) => (have.has(col) ? conv(col, k) : "NULL"));
  await db.run(`
    INSERT INTO assessment (release_id, taxon_id, scope_code, ${targets.join(", ")})
    SELECT ${lit(releaseId)}, _taxon, ${lit(scope)}, ${exprs.join(", ")}
    FROM ${table} ${where ? `WHERE ${where}` : ""}`);
}
