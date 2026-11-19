/**
 * India checklist v10.1 (Praveen & Jayapal). Mints the species backbone:
 * orders, families and one taxon per species, pv + 5 digits from the checklist's serial number.
 * Also loads names, vagrant / historical flags, endemic bird areas, legal status,
 * authorities, alternative names and the two appendices.
 */
import { type Db, lit, nz } from "../duck.ts";
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

const MAIN = "India_Checklist_10_1";
const RAW_ONLY = ["README", "Additional Bibilography"];
const APPENDICES = [
  { sheet: "Appendix 1", n: 1 },
  { sheet: "Appendix 2", n: 2 },
];

/** India checklist endemic-bird-area columns, as written (the 'Cental' typo is the file's). */
export const ENDEMIC_REGION_COLUMNS = [
  "Endemic (Andaman & Nicobar Is)",
  "Endemic (Assam Plains)",
  "Endemic (Cental Indian Forests)",
  "Endemic (Southern Andhra Pradesh)",
  "Endemic (Eastern Himalayas)",
  "Endemic (Indus Plains)",
  "Endemic (Northern Myanmar lowlands)",
  "Endemic (Southern Deccan Plateau)",
  "Endemic (Western Ghats)",
  "Endemic (Western Himalayas)",
];

const SPEC: Record<string, ColumnKind> = {
  "Sl No": { kind: "int" },
  Order: { kind: "text" },
  Family: { kind: "text" },
  "English Name": { kind: "text" },
  "Scientific Name": { kind: "text" },
  Authority: { kind: "text" },
  "Alternative Names": { kind: "text" },
  Vagrant: { kind: "flagX" },
  Historical: { kind: "flagX" },
  "IUCN RedList": { kind: "cat", scheme: "iucn" },
  "WPA Schedule": { kind: "cat", scheme: "wpa" },
  "CITES Appendix": { kind: "cat", scheme: "cites" },
  "CMS Appendix": { kind: "cat", scheme: "cms" },
  "Endemic (India)": { kind: "flagX" },
  ...Object.fromEntries(ENDEMIC_REGION_COLUMNS.map((c) => [c, { kind: "flagX" } as ColumnKind])),
};

const APPENDIX_SPEC: Record<string, ColumnKind> = {
  "Sl No": { kind: "int" },
  Order: { kind: "text" },
  Family: { kind: "text" },
  "English Name": { kind: "text" },
  "Scientific Name": { kind: "text" },
  Authority: { kind: "text" },
};

export type StepLog = (line: string) => void;

export async function loadIndiaChecklist(
  db: Db,
  wb: Workbook,
  r: ReleaseEntry,
  raw: { dir: string } | null,
  log: StepLog,
): Promise<void> {
  const rel = lit(r.release_id);

  // Raw copies of the sheets we don't load as tables
  for (const s of RAW_ONLY) await stage(db, wb, s, "stg_cl_other", raw);

  const main = await stage(db, wb, MAIN, "stg_cl", raw);
  requireColumns(MAIN, main.columns, Object.keys(SPEC));
  await checkColumns(db, "stg_cl", SPEC);
  log(`  ${MAIN}: ${main.rows} rows`);

  // Serial numbers 1..N with no gaps; scientific names unique
  const sl = conv("Sl No", { kind: "int" });
  const gaps = await db.rows(
    `SELECT count(*) AS n, count(DISTINCT ${sl}) AS d, min(${sl}) AS lo, max(${sl}) AS hi FROM stg_cl`,
  );
  const g = gaps[0] as { n: number; d: number; lo: number; hi: number };
  if (!(Number(g.n) === Number(g.d) && Number(g.lo) === 1 && Number(g.hi) === Number(g.n))) {
    throw new LoadError(
      `${MAIN}: 'Sl No' should run 1..${g.n} with no gaps (${JSON.stringify(g)})`,
    );
  }
  const dupNames = await db.rows(
    `SELECT ${nz("Scientific Name")} AS name FROM stg_cl GROUP BY 1 HAVING count(*) > 1 OR name IS NULL`,
  );
  if (dupNames.length) {
    throw new LoadError(`${MAIN}: blank or repeated scientific names: ${JSON.stringify(dupNames)}`);
  }
  const twoOrders = await db.rows(
    `SELECT ${nz("Family")} AS family FROM stg_cl GROUP BY 1 HAVING count(DISTINCT ${nz("Order")}) > 1`,
  );
  if (twoOrders.length) {
    throw new LoadError(`${MAIN}: families in more than one order: ${JSON.stringify(twoOrders)}`);
  }

  // Orders and families, in checklist order
  await db.run(`
    INSERT INTO taxon_order (order_id, sci_name, sort)
    SELECT lower(o), o, row_number() OVER (ORDER BY first) FROM (
      SELECT ${nz("Order")} AS o, min(${sl}) AS first FROM stg_cl GROUP BY 1) x
    WHERE lower(o) NOT IN (SELECT order_id FROM taxon_order)`);
  await db.run(`
    INSERT INTO taxon_family (family_id, order_id, sci_name, sort)
    SELECT lower(f), lower(o), f, row_number() OVER (ORDER BY first) FROM (
      SELECT ${nz("Family")} AS f, any_value(${nz("Order")}) AS o, min(${sl}) AS first
      FROM stg_cl GROUP BY 1) x
    WHERE lower(f) NOT IN (SELECT family_id FROM taxon_family)`);

  // The backbone. First load mints pv00001..; a reload must find the same species in place.
  const existing = await db.count("SELECT count(*) FROM taxon");
  const pv = `'pv' || lpad(CAST(${sl} AS TEXT), 5, '0')`;
  if (existing === 0) {
    await db.run(`
      INSERT INTO taxon (taxon_id, family_id, sort_order, created_in)
      SELECT ${pv}, lower(${nz("Family")}), ${sl}, ${rel} FROM stg_cl ORDER BY ${sl}`);
    log(`  minted ${main.rows} species ids`);
  } else {
    const moved = await db.rows(`
      SELECT ${nz("Scientific Name")} AS name FROM stg_cl s
      WHERE NOT EXISTS (SELECT 1 FROM taxon t WHERE t.taxon_id = ${pv}
                          AND t.sort_order = ${sl} AND t.family_id = lower(${nz("Family")}))
         OR (SELECT count(*) FROM taxon) <> (SELECT count(*) FROM stg_cl)`);
    if (moved.length) {
      throw new LoadError(
        `${MAIN}: the species list differs from the backbone already loaded (${moved.length} rows). ` +
          "Loading a new checklist version needs the matching step (eBird code, name, Avibase ID), not built yet.",
      );
    }
  }

  // Names under the checklist's own authority
  await db.run(`
    INSERT INTO taxon_name (taxon_id, authority, sci_name, en_name, release_id)
    SELECT ${pv}, 'india-v10.1', ${nz("Scientific Name")}, ${nz("English Name")}, ${rel} FROM stg_cl`);
  await requireMatched(db, "stg_cl", "Scientific Name", "india-v10.1");
  await attachTaxon(db, "stg_cl", "Scientific Name", "india-v10.1");

  await db.run(`
    INSERT INTO species_india_status (release_id, taxon_id, endemic_india, vagrant, historical)
    SELECT ${rel}, _taxon, ${conv("Endemic (India)", SPEC["Endemic (India)"] as ColumnKind)},
           ${conv("Vagrant", { kind: "flagX" })}, ${conv("Historical", { kind: "flagX" })}
    FROM stg_cl`);

  for (const col of ENDEMIC_REGION_COLUMNS) {
    await db.run(`
      INSERT INTO species_endemic_region (release_id, taxon_id, region)
      SELECT ${rel}, _taxon, (SELECT code FROM lookup WHERE scheme = 'endemic-region' AND label = ${lit(col)})
      FROM stg_cl WHERE ${conv(col, { kind: "flagX" })}`);
  }

  await db.run(`
    INSERT INTO species_legal (release_id, taxon_id, iucn, wpa_schedule, cites, cms)
    SELECT ${rel}, _taxon,
           ${conv("IUCN RedList", { kind: "cat", scheme: "iucn" })},
           ${conv("WPA Schedule", { kind: "cat", scheme: "wpa" })},
           ${conv("CITES Appendix", { kind: "cat", scheme: "cites" })},
           ${conv("CMS Appendix", { kind: "cat", scheme: "cms" })}
    FROM stg_cl`);

  // Authority and alternative names, kept exactly as written (alternative names are free text
  // with brackets and notes, so they're not split into separate names here)
  for (const [key, col] of [
    ["sci_authority", "Authority"],
    ["alt_names", "Alternative Names"],
  ] as const) {
    await db.run(`
      INSERT INTO species_extra (release_id, taxon_id, key, value_text)
      SELECT ${rel}, _taxon, ${lit(key)}, ${nz(col)} FROM stg_cl WHERE ${nz(col)} IS NOT NULL`);
  }

  for (const a of APPENDICES) {
    const t = `stg_cl_app${a.n}`;
    const s = await stage(db, wb, a.sheet, t, raw);
    requireColumns(a.sheet, s.columns, Object.keys(APPENDIX_SPEC));
    await checkColumns(db, t, APPENDIX_SPEC);
    await db.run(`
      INSERT INTO checklist_appendix
        (release_id, appendix, sl_no, order_sci, family_sci, sci_name, en_name, authority)
      SELECT ${rel}, ${a.n}, ${conv("Sl No", { kind: "int" })}, ${nz("Order")}, ${nz("Family")},
             ${nz("Scientific Name")}, ${nz("English Name")}, ${nz("Authority")}
      FROM ${t}`);
    log(`  ${a.sheet}: ${s.rows} rows`);
  }

  await expectCount(
    db,
    `SELECT count(*) FROM taxon_name WHERE release_id = ${rel}`,
    main.rows,
    "checklist names",
  );
}

export function requireColumns(sheet: string, have: Set<string>, need: string[]): void {
  const missing = need.filter((c) => !have.has(c));
  if (missing.length) {
    throw new LoadError(`sheet "${sheet}" is missing columns: ${missing.join(", ")}`);
  }
}

export async function expectCount(db: Db, sql: string, want: number, what: string): Promise<void> {
  const got = await db.count(sql);
  if (got !== want) throw new LoadError(`${what}: expected ${want} rows, loaded ${got}`);
}
