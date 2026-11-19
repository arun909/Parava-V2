/**
 * eBird/Clements taxonomy (DB3), as the CSV from the eBird API (ref/taxonomy/ebird?version=2025).
 * Adds each species' eBird code to taxon_xref, and its category, taxon order and family to
 * species_extra. Matches on the eBird 2025 scientific name already in taxon_name.
 * Fails unless every active species gets exactly one code.
 */
import { type Db, lit, nz } from "../duck.ts";
import type { ReleaseEntry } from "../manifest.ts";
import { type ColumnKind, checkColumns, conv, LoadError, stage, type Workbook } from "./common.ts";
import { requireColumns, type StepLog } from "./india-checklist.ts";

const SPEC: Record<string, ColumnKind> = {
  SCIENTIFIC_NAME: { kind: "text" },
  COMMON_NAME: { kind: "text" },
  SPECIES_CODE: { kind: "text" },
  CATEGORY: { kind: "cat", scheme: "ebird-category" },
  TAXON_ORDER: { kind: "num" },
  FAMILY_SCI_NAME: { kind: "text" },
  FAMILY_COM_NAME: { kind: "text" },
};

export async function loadEbirdTaxonomy(
  db: Db,
  wb: Workbook,
  r: ReleaseEntry,
  raw: { dir: string } | null,
  log: StepLog,
): Promise<void> {
  const rel = lit(r.release_id);
  const s = await stage(db, wb, "taxonomy", "stg_tax", raw);
  requireColumns("taxonomy", s.columns, Object.keys(SPEC));
  await checkColumns(db, "stg_tax", SPEC);
  log(`  taxonomy: ${s.rows} rows`);

  const dupCodes = await db.rows(
    `SELECT ${nz("SPECIES_CODE")} AS code FROM stg_tax GROUP BY 1 HAVING count(*) > 1 OR code IS NULL`,
  );
  if (dupCodes.length) {
    throw new LoadError(
      `blank or repeated species codes: ${JSON.stringify(dupCodes.slice(0, 10))}`,
    );
  }

  // Each active species must find exactly one eBird species-level row by its eBird 2025 name
  await db.run(`
    CREATE OR REPLACE TEMP TABLE tax_match AS
    SELECT t.taxon_id, n.sci_name, count(x.SPECIES_CODE) AS n, any_value(x._row) AS _row
    FROM taxon t
    JOIN taxon_name n ON n.taxon_id = t.taxon_id AND n.authority = 'ebird-2025'
    LEFT JOIN stg_tax x ON ${nz("SCIENTIFIC_NAME", "x")} = n.sci_name
                       AND ${nz("CATEGORY", "x")} = 'species'
    WHERE t.state = 'active'
    GROUP BY 1, 2`);
  const unnamed = await db.count(`
    SELECT count(*) FROM taxon t WHERE t.state = 'active' AND NOT EXISTS (
      SELECT 1 FROM taxon_name n WHERE n.taxon_id = t.taxon_id AND n.authority = 'ebird-2025')`);
  const bad = await db.rows<{ sci_name: string; n: number }>(
    "SELECT sci_name, n::INTEGER AS n FROM tax_match WHERE n <> 1 ORDER BY sci_name",
  );
  if (unnamed || bad.length) {
    throw new LoadError(
      `${unnamed} active species have no eBird 2025 name; ${bad.length} don't match exactly one eBird species: ${bad
        .slice(0, 20)
        .map((b) => `${b.sci_name} (${b.n})`)
        .join(", ")}. Is this the taxonomy version SoIB used (2025)?`,
    );
  }

  await db.run(`
    INSERT INTO taxon_xref (taxon_id, system, external_id, release_id)
    SELECT m.taxon_id, 'ebird', ${nz("SPECIES_CODE")}, ${rel}
    FROM tax_match m JOIN stg_tax x USING (_row)`);

  const extras: [string, string, "text" | "num"][] = [
    ["ebird_category", "CATEGORY", "text"],
    ["ebird_taxon_order", "TAXON_ORDER", "num"],
    ["ebird_family_sci", "FAMILY_SCI_NAME", "text"],
    ["ebird_family_en", "FAMILY_COM_NAME", "text"],
  ];
  for (const [key, col, kind] of extras) {
    const value =
      kind === "num"
        ? `NULL, ${conv(col, { kind: "num" })}`
        : `${conv(col, { kind: "text" })}, NULL`;
    await db.run(`
      INSERT INTO species_extra (release_id, taxon_id, key, value_text, value_num)
      SELECT ${rel}, m.taxon_id, ${lit(key)}, ${value}
      FROM tax_match m JOIN stg_tax x USING (_row)`);
  }

  // English names should agree with the eBird 2025 names SoIB carries; report, don't fail
  const renamed = await db.count(`
    SELECT count(*) FROM tax_match m JOIN stg_tax x USING (_row)
    JOIN taxon_name n ON n.taxon_id = m.taxon_id AND n.authority = 'ebird-2025'
    WHERE n.en_name IS DISTINCT FROM ${nz("COMMON_NAME")}`);
  log(`  matched ${await db.count("SELECT count(*) FROM tax_match")} species to eBird codes`);
  if (renamed) log(`  note: ${renamed} English names differ from SoIB's eBird 2025 names`);
}
