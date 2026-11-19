import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baseChecks, errorsOf } from "../checks.ts";
import { type Db, ident, lit, nz } from "../duck.ts";
import type { ReleaseEntry } from "../manifest.ts";
import { backupsDir, dbFile, type Paths, rawDir } from "../paths.ts";

/** A loader refused the data. Nothing was written. */
export class LoadError extends Error {
  override name = "LoadError";
}

/** Where a release's sheets are read from. */
export interface Workbook {
  /** SQL table expression for one sheet, every column as text. */
  sheet(name: string): string;
  prepare(db: Db): Promise<void>;
}

export function xlsxWorkbook(file: string): Workbook {
  return {
    sheet: (name) => `read_xlsx(${lit(file)}, sheet = ${lit(name)}, all_varchar = true)`,
    prepare: async (db) => {
      await db.run("INSTALL excel; LOAD excel;");
    },
  };
}

/** Test fixtures: a folder with one CSV per sheet, named <sheet>.csv. */
export function csvWorkbook(dir: string): Workbook {
  return {
    sheet: (name) =>
      `read_csv(${lit(join(dir, `${name}.csv`))}, all_varchar = true, header = true, delim = ',', quote = '"')`,
    prepare: async () => {},
  };
}

/** Copy a sheet into a temp table with a row number, and keep a verbatim Parquet copy. */
export async function stage(
  db: Db,
  wb: Workbook,
  sheet: string,
  table: string,
  raw: { dir: string } | null,
): Promise<{ columns: Set<string>; rows: number }> {
  let expr: string;
  try {
    expr = wb.sheet(sheet);
    await db.run(
      `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT row_number() OVER () AS _row, * FROM ${expr}`,
    );
  } catch (e) {
    throw new LoadError(`could not read sheet "${sheet}": ${(e as Error).message}`);
  }
  // Drop fully empty rows, which spreadsheets sometimes carry at the end
  const cols = (await db.rows<{ column_name: string }>(`DESCRIBE ${table}`))
    .map((r) => r.column_name)
    .filter((c) => c !== "_row");
  await db.run(`DELETE FROM ${table} WHERE ${cols.map((c) => `${nz(c)} IS NULL`).join(" AND ")}`);
  if (raw) {
    mkdirSync(raw.dir, { recursive: true });
    const out = join(raw.dir, `${slug(sheet)}.parquet`);
    await db.run(
      `COPY (SELECT * EXCLUDE (_row) FROM ${table} ORDER BY _row) TO ${lit(out)} (FORMAT parquet)`,
    );
  }
  return { columns: new Set(cols), rows: await db.count(`SELECT count(*) FROM ${table}`) };
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** How a source column must be read. */
export type ColumnKind =
  | { kind: "text" }
  | { kind: "num" }
  | { kind: "int" }
  | { kind: "bool01" } // 0 / 1
  | { kind: "flagX" } // X or blank (India checklist)
  | { kind: "one" } // 1 or blank
  | { kind: "cat"; scheme: string };

/** SQL expression that converts a staged text column. Validate first with checkColumns. */
export function conv(col: string, k: ColumnKind): string {
  const v = nz(col);
  switch (k.kind) {
    case "text":
      return v;
    case "num":
      return `TRY_CAST(${v} AS DOUBLE)`;
    case "int":
      return `CAST(TRY_CAST(${v} AS DOUBLE) AS BIGINT)`;
    case "bool01":
      return `CASE ${v} WHEN '1' THEN TRUE WHEN '0' THEN FALSE END`;
    case "flagX":
      return `(${v} IS NOT NULL)`;
    case "one":
      return `CASE WHEN ${v} = '1' THEN 1 END`;
    case "cat":
      return `(SELECT l.code FROM lookup l WHERE l.scheme = ${lit(k.scheme)} AND l.label = ${v})`;
  }
}

/**
 * Check that every non-blank value in each column can be read as declared.
 * Collects every problem before failing, so one run shows them all.
 */
export async function checkColumns(
  db: Db,
  table: string,
  spec: Record<string, ColumnKind>,
  where = "TRUE",
): Promise<void> {
  const problems: string[] = [];
  for (const [col, k] of Object.entries(spec)) {
    const v = nz(col);
    let bad: string;
    switch (k.kind) {
      case "text":
        continue;
      case "num":
        bad = `TRY_CAST(${v} AS DOUBLE) IS NULL`;
        break;
      case "int":
        bad = `TRY_CAST(${v} AS DOUBLE) IS NULL OR TRY_CAST(${v} AS DOUBLE) <> round(TRY_CAST(${v} AS DOUBLE))`;
        break;
      case "bool01":
        bad = `${v} NOT IN ('0', '1')`;
        break;
      case "flagX":
        bad = `${v} <> 'X'`;
        break;
      case "one":
        bad = `${v} <> '1'`;
        break;
      case "cat":
        bad = `${v} NOT IN (SELECT label FROM lookup WHERE scheme = ${lit(k.scheme)})`;
        break;
    }
    const rows = await db.rows<{ value: string; n: number }>(
      `SELECT ${v} AS value, count(*)::INTEGER AS n FROM ${table}
       WHERE (${where}) AND ${v} IS NOT NULL AND (${bad}) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    );
    for (const r of rows) {
      const what = k.kind === "cat" ? `not in lookup '${k.scheme}'` : `not ${k.kind}`;
      problems.push(`${ident(col)} = ${JSON.stringify(r.value)} (${r.n} rows): ${what}`);
    }
  }
  if (problems.length) throw new LoadError(`${table}: bad values\n  ${problems.join("\n  ")}`);
}

/** Fail if any staged row doesn't match a taxon through the given name authority. */
export async function requireMatched(
  db: Db,
  table: string,
  nameCol: string,
  authority: string,
): Promise<void> {
  const missing = await db.rows<{ name: string }>(
    `SELECT ${nz(nameCol)} AS name FROM ${table} s
     WHERE NOT EXISTS (SELECT 1 FROM taxon_name n
                       WHERE n.authority = ${lit(authority)} AND n.sci_name = ${nz(nameCol)})
     ORDER BY _row`,
  );
  if (missing.length) {
    throw new LoadError(
      `${table}: ${missing.length} rows match no species by ${authority} name: ${missing
        .slice(0, 20)
        .map((m) => m.name)
        .join(", ")}`,
    );
  }
  const dup = await db.rows<{ name: string }>(
    `SELECT ${nz(nameCol)} AS name FROM ${table} GROUP BY 1 HAVING count(*) > 1`,
  );
  if (dup.length) {
    throw new LoadError(`${table}: species listed twice: ${dup.map((d) => d.name).join(", ")}`);
  }
}

/**
 * Add the matched taxon_id to a staged table as column `_taxon`.
 * Call requireMatched first, so every row matches exactly one species.
 */
export async function attachTaxon(
  db: Db,
  table: string,
  nameCol: string,
  authority: string,
): Promise<void> {
  await db.run(
    `CREATE OR REPLACE TEMP TABLE ${table} AS
     SELECT m.taxon_id AS _taxon, s.* FROM ${table} s
     JOIN taxon_name m ON m.authority = ${lit(authority)}
      AND m.sci_name = NULLIF(trim(s.${ident(nameCol)}), '')`,
  );
}

/** Tables whose rows belong to one release; cleared before a release is reloaded. */
const RELEASE_TABLES = [
  "assessment",
  "species_india_status",
  "species_migratory_part",
  "species_endemic_region",
  "species_legal",
  "species_ecology",
  "species_population",
  "species_morphology",
  "species_extra",
  "checklist_appendix",
  "taxon_local_name",
  "taxon_xref",
  "taxon_name",
  "taxon_change",
];

/**
 * Load one or more releases in a single transaction: register them, clear their old rows,
 * run the loader, run the base checks. Any failure rolls everything back.
 */
export async function inReleaseTransaction(
  db: Db,
  releases: ReleaseEntry[],
  fileName: string | null,
  load: () => Promise<void>,
): Promise<void> {
  await db.run("BEGIN TRANSACTION");
  try {
    for (const r of releases) {
      const exists = await db.count(
        `SELECT count(*) FROM source_release WHERE release_id = ${lit(r.release_id)}`,
      );
      const values = {
        version: lit(r.version),
        published: r.published ? `DATE ${lit(r.published)}` : "NULL",
        status: lit(r.status),
        // A columns-of release has no file of its own; its notes say where it lives
        file_name: fileName && r.format !== "columns-of" ? lit(fileName) : "NULL",
        file_sha256: r.sha256 ? lit(r.sha256) : "NULL",
        loaded_at: "current_timestamp::TIMESTAMP",
        notes: r.notes ? lit(r.notes) : "NULL",
      };
      if (exists) {
        // Release rows are referenced by facts, so update in place rather than replace
        const set = Object.entries(values)
          .map(([k, v]) => `${k} = ${v}`)
          .join(", ");
        await db.run(`UPDATE source_release SET ${set} WHERE release_id = ${lit(r.release_id)}`);
      } else {
        await db.run(
          `INSERT INTO source_release (release_id, source_id, ${Object.keys(values).join(", ")})
           VALUES (${lit(r.release_id)}, ${lit(r.source_id)}, ${Object.values(values).join(", ")})`,
        );
      }
      for (const t of RELEASE_TABLES) {
        await db.run(`DELETE FROM ${t} WHERE release_id = ${lit(r.release_id)}`);
      }
    }
    await load();
    const errors = errorsOf(await baseChecks(db));
    if (errors.length) {
      throw new LoadError(
        `checks failed:\n  ${errors.map((c) => `${c.id}: ${c.detail}`).join("\n  ")}`,
      );
    }
    await db.run("COMMIT");
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}

/**
 * Copy the closed base file to backups/, tagged with the releases it holds and the date.
 * Call only after the connection to the base is closed.
 */
export function backupBase(p: Paths, releases: string[]): string {
  const dir = backupsDir(p);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = join(dir, `parava_base__${releases.join("__")}__${stamp}.duckdb`);
  copyFileSync(dbFile(p, "base"), out);
  return out;
}

export const rawFor = (p: Paths, r: ReleaseEntry) => ({
  dir: rawDir(p, r.source_id, r.release_id),
});
