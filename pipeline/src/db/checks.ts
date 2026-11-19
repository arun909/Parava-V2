import { existsSync } from "node:fs";
import { join } from "node:path";
import { Db, ident, lit } from "./duck.ts";
import { slug } from "./load/common.ts";
import { dbFile, type Paths, rawDir } from "./paths.ts";

export interface Check {
  id: string;
  level: "error" | "warn" | "info";
  ok: boolean;
  detail: string;
}

export const errorsOf = (cs: Check[]): Check[] => cs.filter((c) => !c.ok && c.level === "error");

const ok = (id: string, detail = ""): Check => ({ id, level: "error", ok: true, detail });
const fail = (id: string, detail: string): Check => ({ id, level: "error", ok: false, detail });

/** Category columns and the lookup scheme each must use. */
const CATEGORY_COLUMNS: { table: string; column: string; scheme: string; where?: string }[] = [
  { table: "species_india_status", column: "migratory_status", scheme: "migratory" },
  { table: "species_india_status", column: "endemicity", scheme: "endemicity" },
  { table: "species_migratory_part", column: "part", scheme: "migratory-part" },
  { table: "species_endemic_region", column: "region", scheme: "endemic-region" },
  { table: "species_legal", column: "iucn", scheme: "iucn" },
  { table: "species_legal", column: "wpa_schedule", scheme: "wpa" },
  { table: "species_legal", column: "cites", scheme: "cites" },
  { table: "species_legal", column: "cms", scheme: "cms" },
  { table: "species_ecology", column: "diet", scheme: "diet" },
  { table: "species_ecology", column: "habitat_spec", scheme: "habitat" },
  { table: "species_ecology", column: "activity_breeding", scheme: "activity" },
  { table: "species_ecology", column: "activity_nonbreeding", scheme: "activity" },
  { table: "species_ecology", column: "trophic_level", scheme: "avonet-trophic-level" },
  { table: "species_ecology", column: "primary_lifestyle", scheme: "avonet-lifestyle" },
  { table: "assessment", column: "regional_red_list", scheme: "iucn" },
  ...(
    [
      ["priority", "soib-concern-2020", "soib-priority-2023"],
      ["lt_status", "soib-trend-2020", "soib-trend-2023"],
      ["cat_status", "soib-trend-2020", "soib-trend-2023"],
      ["range_status", "soib-range-2020", "soib-range-2023"],
    ] as const
  ).flatMap(([column, old, cur]) => [
    { table: "assessment", column, scheme: old, where: "release_id = 'soib-2020'" },
    { table: "assessment", column, scheme: cur, where: "release_id <> 'soib-2020'" },
  ]),
];

/** Value rules: [table, SQL condition that must hold where the values exist, description]. */
const VALUE_RULES: [string, string, string][] = [
  [
    "assessment",
    "lt_lci_pct <= lt_mean_pct AND lt_mean_pct <= lt_uci_pct",
    "long-term lci <= mean <= uci",
  ],
  [
    "assessment",
    "cat_lci_pct <= cat_mean_pct AND cat_mean_pct <= cat_uci_pct",
    "current lci <= mean <= uci",
  ],
  [
    "assessment",
    "range_lci_km2 <= range_mean_km2 AND range_mean_km2 <= range_uci_km2",
    "range lci <= mean <= uci",
  ],
  ["assessment", "coverage_pre2000_pct BETWEEN 0 AND 100", "coverage pre-2000 is a percentage"],
  ["assessment", "coverage_current_pct BETWEEN 0 AND 100", "coverage current is a percentage"],
  ["assessment", "coverage_latest_pct BETWEEN 0 AND 100", "coverage 2025 is a percentage"],
  ["assessment", "decline_3gen_pct BETWEEN 0 AND 100", "3-generation decline is a percentage"],
  ["assessment", "n_grids >= 0", "grid count not negative"],
  [
    "species_population",
    "share_global_range_frac BETWEEN 0 AND 1",
    "share of global range is a fraction",
  ],
  ["species_population", "generation_years > 0", "generation length positive"],
  ["species_population", "pct1_threshold > 0", "1% threshold positive"],
  ["species_population", "n_subspecies_india >= 0", "subspecies count not negative"],
  ...[
    "mass_g",
    "length_cm",
    "wingspan_cm",
    "wing_mm",
    "tail_mm",
    "tarsus_mm",
    "beak_culmen_mm",
    "beak_depth_mm",
    "beak_width_mm",
    "hand_wing_index",
  ].map((c): [string, string, string] => ["species_morphology", `${c} > 0`, `${c} positive`]),
];

/** Checks on the base alone. Run by every loader inside its transaction. */
export async function baseChecks(db: Db): Promise<Check[]> {
  const out: Check[] = [];

  // 1. Every fact row maps to a species and a scope
  const cat = String(await db.value("SELECT current_database()"));
  out.push(...(await referenceChecks(db, [cat])));

  // 2. Every category exists in lookup for its scheme
  const badCats: string[] = [];
  for (const c of CATEGORY_COLUMNS) {
    const rows = await db.rows<{ v: string; n: number }>(`
      SELECT ${ident(c.column)} AS v, count(*)::INTEGER AS n FROM ${c.table}
      WHERE ${ident(c.column)} IS NOT NULL AND (${c.where ?? "TRUE"})
        AND ${ident(c.column)} NOT IN (SELECT code FROM lookup WHERE scheme = ${lit(c.scheme)})
      GROUP BY 1`);
    for (const r of rows) badCats.push(`${c.table}.${c.column}=${r.v} (${r.n}) not in ${c.scheme}`);
  }
  out.push(badCats.length ? fail("categories", badCats.join("; ")) : ok("categories"));

  // 3. Values in range
  const badValues: string[] = [];
  for (const [table, cond, what] of VALUE_RULES) {
    const n = await db.count(`SELECT count(*) FROM ${table} WHERE NOT (${cond})`);
    if (n) badValues.push(`${table}: ${what} fails for ${n} rows`);
  }
  out.push(badValues.length ? fail("values", badValues.join("; ")) : ok("values"));

  // SoIB publishes a few modelled range intervals that dip below zero for tiny ranges.
  // They are kept as published; the export must clamp them before showing them.
  const negRange = await db.rows<{ scope_code: string; en_name: string; lci: number }>(`
    SELECT a.scope_code, n.en_name, a.range_lci_km2 AS lci FROM assessment a
    JOIN taxon_name n ON n.taxon_id = a.taxon_id AND n.authority = 'india-v10.1'
    WHERE a.range_lci_km2 < 0 ORDER BY 1, 2`);
  if (negRange.length) {
    out.push({
      id: "range-lci-negative",
      level: "warn",
      ok: false,
      detail: `kept as published: ${negRange.map((r) => `${r.en_name} (${r.scope_code}, ${r.lci})`).join("; ")}`,
    });
  }

  // 4. Species ids: pv + 5 digits, continuous for the first release, never shared
  const ids = await db.rows<{ n: number; bad: number; first: string | null }>(`
    SELECT count(*)::INTEGER AS n,
           count(*) FILTER (WHERE NOT regexp_matches(taxon_id, '^pv[0-9]{5}$'))::INTEGER AS bad,
           min(created_in) AS first FROM taxon`);
  const id = ids[0];
  if (id && id.n > 0) {
    const firstRelease = await db.value(`SELECT created_in FROM taxon ORDER BY taxon_id LIMIT 1`);
    const gaps = await db.count(`
      SELECT count(*) FROM (
        SELECT taxon_id, row_number() OVER (ORDER BY taxon_id) AS i FROM taxon
        WHERE created_in = ${lit(String(firstRelease))})
      WHERE taxon_id <> 'pv' || lpad(CAST(i AS TEXT), 5, '0')`);
    out.push(
      id.bad || gaps
        ? fail("taxon-ids", `${id.bad} malformed ids, ${gaps} gaps in the first release`)
        : ok("taxon-ids", `${id.n} species`),
    );
  }

  const shared = await db.rows<{ system: string; external_id: string; n: number }>(`
    SELECT x.system, x.external_id, count(*)::INTEGER AS n FROM taxon_xref x
    JOIN taxon t ON t.taxon_id = x.taxon_id AND t.state = 'active'
    WHERE x.system IN ('ebird', 'avibase') GROUP BY 1, 2 HAVING count(*) > 1`);
  out.push(
    shared.length
      ? fail("xref-unique", JSON.stringify(shared.slice(0, 10)))
      : ok("xref-unique", "no two active species share an eBird code or Avibase ID"),
  );

  // Once the eBird taxonomy is loaded, every active species has exactly one eBird code
  if (await db.count("SELECT count(*) FROM source_release WHERE source_id = 'ebird-tax'")) {
    const noCode = await db.count(`
      SELECT count(*) FROM taxon t WHERE t.state = 'active' AND NOT EXISTS (
        SELECT 1 FROM taxon_xref x WHERE x.taxon_id = t.taxon_id AND x.system = 'ebird')`);
    out.push(
      noCode
        ? fail("ebird-codes", `${noCode} active species have no eBird code`)
        : ok("ebird-codes", "every active species has one eBird code"),
    );
  }
  // Once AVONET is loaded, at least 95% of active species have its measurements
  if (await db.count("SELECT count(*) FROM source_release WHERE source_id = 'avonet'")) {
    const [m] = await db.rows<{ active: number; measured: number }>(`
      SELECT (SELECT count(*) FROM taxon WHERE state = 'active')::INTEGER AS active,
             (SELECT count(DISTINCT m.taxon_id) FROM species_morphology m
              JOIN source_release r USING (release_id) WHERE r.source_id = 'avonet')::INTEGER AS measured`);
    const { active = 0, measured = 0 } = m ?? {};
    out.push(
      measured >= 0.95 * active
        ? ok("avonet-coverage", `${measured} of ${active} species have AVONET measurements`)
        : fail("avonet-coverage", `only ${measured} of ${active} species have AVONET measurements`),
    );
  }

  const unnamed = await db.count(`
    SELECT count(*) FROM taxon t WHERE t.state = 'active' AND NOT EXISTS (
      SELECT 1 FROM taxon_name n WHERE n.taxon_id = t.taxon_id AND n.authority = 'india-v10.1')`);
  out.push(
    unnamed
      ? fail("names", `${unnamed} active species without an India checklist name`)
      : ok("names"),
  );

  // 5. Licences recorded; unconfirmed ones flagged
  const lic = await db.rows<{ release_id: string; licence: string | null }>(`
    SELECT r.release_id, s.licence FROM source_release r JOIN source s USING (source_id) ORDER BY 1`);
  const none = lic.filter((l) => !l.licence);
  out.push(
    none.length
      ? fail("licences", `no licence for ${none.map((l) => l.release_id).join(", ")}`)
      : ok("licences"),
  );
  const toConfirm = lic.filter((l) => l.licence === "to-confirm");
  if (toConfirm.length) {
    out.push({
      id: "licences-to-confirm",
      level: "warn",
      ok: false,
      detail: `publish nothing from: ${toConfirm.map((l) => l.release_id).join(", ")}`,
    });
  }
  return out;
}

/** Rows in the given catalogs whose taxon_id or scope_code isn't in the base. */
async function referenceChecks(db: Db, catalogs: string[], base = ""): Promise<Check[]> {
  const prefix = base ? `${base}.` : "";
  const cols = await db.rows<{ cat: string; tbl: string; col: string }>(`
    SELECT c.table_catalog AS cat, c.table_name AS tbl, c.column_name AS col
    FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_catalog = c.table_catalog AND t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE t.table_type = 'BASE TABLE' AND c.table_schema = 'main'
      AND c.table_catalog IN (${catalogs.map(lit).join(", ")})
      AND c.column_name IN ('taxon_id', 'taxon_a', 'taxon_b', 'scope_code', 'from_taxon', 'to_taxon')
    ORDER BY 1, 2, 3`);
  const bad: string[] = [];
  for (const { cat, tbl, col } of cols) {
    const isScope = col === "scope_code";
    const target = isScope ? `${prefix}main.scope` : `${prefix}main.taxon`;
    const key = isScope ? "scope_code" : "taxon_id";
    const n = await db.count(`
      SELECT count(*) FROM ${ident(cat)}.main.${ident(tbl)} x
      WHERE x.${ident(col)} IS NOT NULL
        AND x.${ident(col)} NOT IN (SELECT ${key} FROM ${target})`);
    if (n) bad.push(`${cat}.${tbl}.${col}: ${n} rows`);
  }
  return [
    bad.length
      ? fail("references", `unknown species or scope in ${bad.join("; ")}`)
      : ok("references", `${cols.length} columns checked`),
  ];
}

/** Every check, across the three files and the raw copies. Opens everything read-only. */
export async function allChecks(p: Paths): Promise<Check[]> {
  const db = await Db.open(":memory:");
  try {
    await db.run(`ATTACH ${lit(dbFile(p, "base"))} AS base (READ_ONLY)`);
    await db.run(`ATTACH ${lit(dbFile(p, "derived"))} AS derived (READ_ONLY)`);
    await db.run(`ATTACH ${lit(dbFile(p, "content"))} AS content (READ_ONLY)`);
    await db.run("USE base");
    const out = await baseChecks(db);
    out.push(
      ...(await referenceChecks(db, ["derived", "content"], "base")).map((c) => ({
        ...c,
        id: "references-across-files",
      })),
    );
    out.push(await rawCountCheck(db, p));
    out.push(await nameDiffInfo(db));
    return out;
  } finally {
    db.close();
  }
}

/** Loaded row counts must match the raw sheets kept beside the database. */
async function rawCountCheck(db: Db, p: Paths): Promise<Check> {
  const problems: string[] = [];
  let compared = 0;
  const count = async (file: string) =>
    existsSync(file) ? db.count(`SELECT count(*) FROM read_parquet(${lit(file)})`) : null;
  const compare = (what: string, raw: number | null, loaded: number) => {
    if (raw === null) problems.push(`${what}: raw copy missing`);
    else if (raw !== loaded) problems.push(`${what}: raw ${raw}, loaded ${loaded}`);
    compared++;
  };

  const releases = await db.rows<{ release_id: string; source_id: string }>(
    "SELECT release_id, source_id FROM source_release WHERE file_name IS NOT NULL ORDER BY 1",
  );
  for (const { release_id, source_id } of releases) {
    const dir = rawDir(p, source_id, release_id);
    const rel = lit(release_id);
    if (source_id === "india-checklist") {
      compare(
        `${release_id} main list`,
        await count(join(dir, `${slug("India_Checklist_10_1")}.parquet`)),
        await db.count(`SELECT count(*) FROM taxon_name WHERE release_id = ${rel}`),
      );
      for (const n of [1, 2]) {
        compare(
          `${release_id} appendix ${n}`,
          await count(join(dir, `${slug(`Appendix ${n}`)}.parquet`)),
          await db.count(
            `SELECT count(*) FROM checklist_appendix WHERE release_id = ${rel} AND appendix = ${n}`,
          ),
        );
      }
    }
    if (source_id === "soib") {
      const sheets = await db.rows<{ alias: string; scope_code: string }>(
        "SELECT alias, scope_code FROM scope_alias WHERE source_id = 'soib' ORDER BY 1",
      );
      for (const s of sheets) {
        compare(
          `${release_id} ${s.alias}`,
          await count(join(dir, `${slug(s.alias)}.parquet`)),
          await db.count(
            `SELECT count(*) FROM assessment WHERE release_id = ${rel} AND scope_code = ${lit(s.scope_code)}`,
          ),
        );
      }
      const indiaFile = join(dir, "india.parquet");
      const india = await count(indiaFile);
      for (const t of [
        "species_india_status",
        "species_legal",
        "species_ecology",
        "species_population",
      ]) {
        compare(
          `${release_id} India -> ${t}`,
          india,
          await db.count(`SELECT count(*) FROM ${t} WHERE release_id = ${rel}`),
        );
      }
      // SoIB 2020: one row for each India row with any 2020 value
      if (india !== null) {
        const raw2020 = await db.count(`
          SELECT count(*) FROM read_parquet(${lit(indiaFile)}) WHERE coalesce(
            NULLIF(trim("SoIB 2020 Concern Status"), ''),
            NULLIF(trim("SoIB 2020 Long-term Trend Status"), ''),
            NULLIF(trim("SoIB 2020 Current Annual Trend Status"), ''),
            NULLIF(trim("SoIB 2020 Distribution Range Size Status"), '')) IS NOT NULL`);
        compare(
          "soib-2020 (India sheet 2020 columns)",
          raw2020,
          await db.count("SELECT count(*) FROM assessment WHERE release_id = 'soib-2020'"),
        );
      }
    }
  }
  return problems.length
    ? fail("row-counts", problems.join("; "))
    : ok("row-counts", `${compared} sheet and table counts match the raw copies`);
}

async function nameDiffInfo(db: Db): Promise<Check> {
  const n = await db.count(`
    SELECT count(*) FROM taxon_name a JOIN taxon_name b
      ON a.taxon_id = b.taxon_id AND a.authority = 'india-v10.1' AND b.authority = 'india-2025'
    WHERE a.sci_name IS DISTINCT FROM b.sci_name OR a.en_name IS DISTINCT FROM b.en_name`);
  return {
    id: "checklist-vs-soib-names",
    level: "info",
    ok: n === 0,
    detail: `${n} species where SoIB's checklist name differs from the checklist file`,
  };
}
