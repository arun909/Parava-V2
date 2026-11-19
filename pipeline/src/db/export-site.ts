/**
 * Dev export: species records from the base database for the site to read at build time.
 *
 *   bun run db:export-site [outDir]     default: site/.data
 *
 * Writes species/index.json, species/{slug}.json and lookups.json. The output is
 * gitignored: SoIB's licence is unconfirmed, so nothing here is published yet.
 * The real versioned export (v/{run}/…) is the pipeline's `export` stage.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Assessment,
  Lookups,
  SpeciesDetail,
  SpeciesName,
  SpeciesSummary,
} from "@parava/shared";
import { Db, type Row } from "./duck.ts";
import { dbFile, defaultPaths } from "./paths.ts";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));

/** Group rows by taxon_id. */
function byTaxon(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const id = String(r.taxon_id);
    const list = m.get(id);
    if (list) list.push(r);
    else m.set(id, [r]);
  }
  return m;
}

export async function exportSite(db: Db, outDir: string): Promise<number> {
  // One query per table; joined in memory. Cheap at ~1,400 species.
  const species = await db.rows(`
    SELECT s.*, f.order_id, o.sci_name AS order_sci
    FROM current_species s
    JOIN taxon t USING (taxon_id)
    JOIN taxon_family f ON f.family_id = t.family_id
    JOIN taxon_order o ON o.order_id = f.order_id
    ORDER BY s.sort_order`);
  const status = byTaxon(await db.rows("SELECT * FROM current_india_status"));
  const legal = byTaxon(await db.rows("SELECT * FROM current_legal"));
  const ecology = byTaxon(await db.rows("SELECT * FROM current_ecology"));
  const morphology = byTaxon(await db.rows("SELECT * FROM current_morphology"));
  const population = byTaxon(await db.rows("SELECT * FROM current_population"));
  const xrefs = byTaxon(await db.rows("SELECT taxon_id, system, external_id FROM taxon_xref"));
  const names = byTaxon(
    await db.rows(
      "SELECT taxon_id, authority, sci_name, en_name FROM taxon_name ORDER BY authority",
    ),
  );
  const extras = byTaxon(
    await db.rows(`SELECT taxon_id, key, value_text FROM species_extra
                   WHERE key IN ('sci_authority', 'alt_names')`),
  );
  const parts = byTaxon(
    await db.rows(`SELECT taxon_id, part FROM species_migratory_part p
                   JOIN current_release r USING (release_id) ORDER BY part`),
  );
  const regions = byTaxon(
    await db.rows(`SELECT taxon_id, region FROM species_endemic_region e
                   JOIN current_release r USING (release_id) ORDER BY region`),
  );
  const assessments = byTaxon(
    await db.rows(`SELECT a.*, s.name_en AS scope_name FROM current_assessment a
                   LEFT JOIN scope s USING (scope_code)
                   ORDER BY a.scope_code <> 'IN', a.scope_code LIKE 'hab:%', s.name_en`),
  );
  const releases = (await db.rows("SELECT release_id FROM current_release ORDER BY 1")).map((r) =>
    String(r.release_id),
  );

  const lookups: Lookups = {};
  for (const r of await db.rows("SELECT scheme, code, label FROM lookup ORDER BY scheme, rank")) {
    const scheme = String(r.scheme);
    lookups[scheme] ??= {};
    lookups[scheme][String(r.code)] = String(r.label);
  }

  const dir = join(outDir, "species");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const index: SpeciesSummary[] = [];
  for (const s of species) {
    const id = String(s.taxon_id);
    const x = Object.fromEntries((xrefs.get(id) ?? []).map((r) => [r.system, r.external_id]));
    const extra = Object.fromEntries((extras.get(id) ?? []).map((r) => [r.key, r.value_text]));
    const st = status.get(id)?.[0] ?? {};
    const lg = legal.get(id)?.[0] ?? {};
    const ec = ecology.get(id)?.[0] ?? {};
    const mo = morphology.get(id)?.[0] ?? {};
    const po = population.get(id)?.[0] ?? {};

    const summary: SpeciesSummary = {
      id,
      slug: String(x.ebird ?? id),
      sortOrder: Number(s.sort_order),
      enName: String(s.en_name),
      sciName: String(s.sci_name),
      familySci: String(s.family_sci),
      familyEn: str(s.family_en),
      migratoryStatus: str(s.migratory_status),
      iucn: str(s.iucn),
      priority: str(s.priority),
      endemicIndia: bool(s.endemic_india),
    };

    const detail: SpeciesDetail = {
      ...summary,
      orderSci: String(s.order_sci),
      authority: str(extra.sci_authority),
      xrefs: x as Record<string, string>,
      names: (names.get(id) ?? []).map(
        (n): SpeciesName => ({
          authority: String(n.authority),
          sciName: String(n.sci_name),
          enName: str(n.en_name),
        }),
      ),
      altNames: str(extra.alt_names),
      status: {
        migratoryParts: (parts.get(id) ?? []).map((r) => String(r.part)),
        endemicity: str(st.endemicity),
        endemicRegions: (regions.get(id) ?? []).map((r) => String(r.region)),
        vagrant: bool(st.vagrant),
        historical: bool(st.historical),
      },
      legal: { wpaSchedule: str(lg.wpa_schedule), cites: str(lg.cites), cms: str(lg.cms) },
      ecology: {
        diet: str(ec.diet),
        habitat: str(ec.habitat_spec),
        activityBreeding: str(ec.activity_breeding),
        activityNonbreeding: str(ec.activity_nonbreeding),
        trophicLevel: str(ec.trophic_level),
        lifestyle: str(ec.primary_lifestyle),
      },
      morphology: {
        massG: num(mo.mass_g),
        lengthCm: num(mo.length_cm),
        wingspanCm: num(mo.wingspan_cm),
        wingMm: num(mo.wing_mm),
        handWingIndex: num(mo.hand_wing_index),
      },
      population: {
        generationYears: num(po.generation_years),
        shareGlobalRange: num(po.share_global_range_frac),
        pct1Threshold: num(po.pct1_threshold),
        nSubspeciesIndia: num(po.n_subspecies_india),
      },
      assessments: (assessments.get(id) ?? []).map(
        (a): Assessment => ({
          scope: String(a.scope_code),
          scopeName: str(a.scope_name),
          priority: str(a.priority),
          longTerm: {
            status: str(a.lt_status),
            meanPct: num(a.lt_mean_pct),
            lciPct: num(a.lt_lci_pct),
            uciPct: num(a.lt_uci_pct),
          },
          current: {
            status: str(a.cat_status),
            meanPct: num(a.cat_mean_pct),
            lciPct: num(a.cat_lci_pct),
            uciPct: num(a.cat_uci_pct),
          },
          rangeStatus: str(a.range_status),
          rangeKm2: num(a.range_mean_km2),
          nGrids: num(a.n_grids),
        }),
      ),
      releases,
    };

    index.push(summary);
    writeFileSync(join(dir, `${summary.slug}.json`), JSON.stringify(detail));
  }

  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  writeFileSync(join(outDir, "lookups.json"), JSON.stringify(lookups));
  return index.length;
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? new URL("../../../site/.data", import.meta.url).pathname;
  const db = await Db.open(dbFile(defaultPaths(), "base"), { readOnly: true });
  try {
    const n = await exportSite(db, outDir);
    console.log(`Exported ${n} species to ${outDir}`);
  } finally {
    db.close();
  }
}
