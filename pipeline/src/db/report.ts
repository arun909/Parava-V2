import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allChecks, type Check } from "./checks.ts";
import { Db, lit, type Row } from "./duck.ts";
import { dbFile, type Paths } from "./paths.ts";

const table = (rows: Row[]): string => {
  const first = rows[0];
  if (!first) return "_none_\n";
  const cols = Object.keys(first);
  const esc = (v: unknown) => String(v ?? "").replaceAll("|", "\\|");
  return [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => esc(r[c])).join(" | ")} |`),
  ].join("\n");
};

const BASE_TABLES = [
  "source",
  "source_release",
  "taxon_order",
  "taxon_family",
  "taxon",
  "taxon_name",
  "taxon_xref",
  "taxon_change",
  "lookup",
  "field_precedence",
  "scope",
  "scope_alias",
  "species_india_status",
  "species_migratory_part",
  "species_endemic_region",
  "species_legal",
  "species_ecology",
  "species_population",
  "species_morphology",
  "taxon_local_name",
  "species_extra",
  "checklist_appendix",
  "assessment",
];

const RELEASE_TAGGED = [
  "taxon_name",
  "taxon_xref",
  "species_india_status",
  "species_migratory_part",
  "species_endemic_region",
  "species_legal",
  "species_ecology",
  "species_population",
  "species_morphology",
  "taxon_local_name",
  "species_extra",
  "checklist_appendix",
  "assessment",
];

/** Write docs/reports/db-<date>.md and return its path. */
export async function writeReport(p: Paths): Promise<string> {
  const checks = await allChecks(p);
  const db = await Db.open(dbFile(p, "base"), { readOnly: true });
  try {
    const parts: string[] = [];
    const date = new Date().toISOString().slice(0, 10);
    parts.push(`# Parava species database: ${date}\n`);

    parts.push("## Releases loaded\n");
    parts.push(
      table(
        await db.rows(`
          SELECT r.release_id, r.source_id, r.status, r.published::TEXT AS published, s.licence,
                 r.file_name, substr(r.file_sha256, 1, 12) AS sha256, r.loaded_at::TEXT AS loaded_at
          FROM source_release r JOIN source s USING (source_id) ORDER BY 1`),
      ),
    );
    parts.push(
      `\nCurrent release per source: ${(
        await db.rows<{ source_id: string; release_id: string }>(
          "SELECT * FROM current_release ORDER BY 1",
        )
      )
        .map((r) => `${r.source_id} = ${r.release_id}`)
        .join(", ")}\n`,
    );

    parts.push("## Row counts per table\n");
    const counts: Row[] = [];
    for (const t of BASE_TABLES) {
      counts.push({ table: t, rows: await db.count(`SELECT count(*) FROM ${t}`) });
    }
    parts.push(table(counts));

    parts.push("\n## Facts per release\n");
    const perRelease: Row[] = [];
    for (const t of RELEASE_TAGGED) {
      perRelease.push(
        ...(await db.rows(
          `SELECT ${lit(t)} AS "table", release_id, count(*)::INTEGER AS "rows" FROM ${t} GROUP BY 2 ORDER BY 2`,
        )),
      );
    }
    parts.push(table(perRelease));

    parts.push("\n## Assessments per scope\n");
    parts.push(
      table(
        await db.rows(`
          SELECT a.scope_code, s.name_en, s.kind, a.release_id, count(*)::INTEGER AS species,
                 count(*) FILTER (WHERE a.priority = 'high')::INTEGER AS high_priority,
                 count(*) FILTER (WHERE a.is_key_species)::INTEGER AS key_species
          FROM assessment a JOIN scope s USING (scope_code)
          GROUP BY 1, 2, 3, 4 ORDER BY (a.scope_code = 'IN') DESC, s.kind DESC, 1, 4`),
      ),
    );

    parts.push("\n## Unmatched names\n");
    parts.push(
      "None: loaders stop on any unmatched name, so a finished load has none. Species are matched on the India checklist scientific name.\n",
    );

    parts.push("## Check results\n");
    parts.push(
      table(
        checks.map((c: Check) => ({
          check: c.id,
          level: c.level,
          result: c.ok ? "pass" : c.level === "error" ? "FAIL" : c.level,
          detail: c.detail,
        })),
      ),
    );

    parts.push("\n## SoIB 2020 to 2026 v0: national changes\n");
    parts.push(
      "Compared by normalised label, so 'Strong Decline' (2020) equals 'Rapid Decline' (2023).\n",
    );
    const changed = await db.rows(`
      SELECT n.en_name AS species,
             po.label AS priority_2020, pn.label AS priority_2026,
             lo.label AS long_term_2020, ln.label AS long_term_2026
      FROM assessment new
      JOIN assessment old ON old.taxon_id = new.taxon_id AND old.scope_code = new.scope_code
       AND old.release_id = 'soib-2020'
      JOIN taxon t ON t.taxon_id = new.taxon_id
      JOIN taxon_name n ON n.taxon_id = new.taxon_id AND n.authority = 'india-v10.1'
      LEFT JOIN lookup po ON po.scheme = 'soib-concern-2020' AND po.code = old.priority
      LEFT JOIN lookup pn ON pn.scheme = 'soib-priority-2023' AND pn.code = new.priority
      LEFT JOIN lookup lo ON lo.scheme = 'soib-trend-2020' AND lo.code = old.lt_status
      LEFT JOIN lookup ln ON ln.scheme = 'soib-trend-2023' AND ln.code = new.lt_status
      WHERE new.release_id = 'soib-2026-v0' AND new.scope_code = 'IN'
        AND (po.normalized IS DISTINCT FROM pn.normalized OR lo.normalized IS DISTINCT FROM ln.normalized)
      ORDER BY t.sort_order`);
    const moves = await db.rows(`
      SELECT coalesce(po.normalized, '(none)') AS priority_2020, coalesce(pn.normalized, '(none)') AS priority_2026,
             count(*)::INTEGER AS species
      FROM assessment new
      JOIN assessment old ON old.taxon_id = new.taxon_id AND old.scope_code = new.scope_code
       AND old.release_id = 'soib-2020'
      LEFT JOIN lookup po ON po.scheme = 'soib-concern-2020' AND po.code = old.priority
      LEFT JOIN lookup pn ON pn.scheme = 'soib-priority-2023' AND pn.code = new.priority
      WHERE new.release_id = 'soib-2026-v0' AND new.scope_code = 'IN'
        AND po.normalized IS DISTINCT FROM pn.normalized
      GROUP BY 1, 2 ORDER BY 3 DESC`);
    parts.push(`${changed.length} species changed priority or long-term trend.\n`);
    parts.push("### Priority moves\n");
    parts.push(table(moves));
    parts.push("\n### Every changed species\n");
    parts.push(table(changed));

    parts.push("\n## Open items\n");
    parts.push(
      [
        "- field_precedence and the lookup lists are proposals: review before exports use them.",
        "- SoIB and India checklist licences are 'to-confirm': nothing from them may be published.",
        "- Not loaded yet: eBird taxonomy 2025 (DB3), AVONET (DB4), Wikidata (DB5).",
      ].join("\n"),
    );

    const out = join(p.reportsDir, `db-${date}.md`);
    mkdirSync(p.reportsDir, { recursive: true });
    writeFileSync(out, `${parts.join("\n")}\n`);
    return out;
  } finally {
    db.close();
  }
}
