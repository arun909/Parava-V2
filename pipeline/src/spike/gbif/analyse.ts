/**
 * Spike: can GBIF's eBird records give weekly frequencies and arrival forecasts?
 * Reads .data/spike/raw/<name>.jsonl (search API) or <name>.tsv (SQL download),
 * matches species to the base, computes frequencies and phenology, backtests the
 * forecast gate, and writes docs/reports/spike-gbif-<name>.md.
 *
 *   bun pipeline/src/spike/gbif/analyse.ts mizoram "Mizoram"
 *
 * Everything lives in .data/spike/spike.duckdb; the base is attached read-only.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Db, lit, type Row } from "../../db/duck.ts";
import { dbFile, defaultPaths } from "../../db/paths.ts";

const [name, label = name] = process.argv.slice(2);
if (!name) {
  console.error('usage: analyse.ts <name> ["State name"]');
  process.exit(2);
}

const EBIRD = "4fa7b334-ce0d-4e88-aaae-2e0c138d049e";
/** Minimum checklists in a week of one year for that week to count in phenology. */
const MIN_LISTS = 5;
/** Minimum seasons with an estimate before a species is backtested. */
const MIN_SEASONS = 5;

const p = defaultPaths();
const rawDir = join(p.dataDir, "spike", "raw");
const jsonl = join(rawDir, `${name}.jsonl`);
const tsv = join(rawDir, `${name}.tsv`);
const source = existsSync(tsv)
  ? `(SELECT * FROM read_csv(${lit(tsv)}, delim = '\t', header = true, quote = '', escape = '', all_varchar = true))`
  : existsSync(jsonl)
    ? `(SELECT *, NULL::VARCHAR AS verbatimscientificname FROM read_json(${lit(jsonl)}, format = 'newline_delimited'))`
    : null;
if (!source) {
  console.error(`no raw file for ${name} in ${rawDir}`);
  process.exit(1);
}

mkdirSync(join(p.dataDir, "spike"), { recursive: true });
const db = await Db.open(join(p.dataDir, "spike", `${name}.duckdb`));
await db.run(`ATTACH ${lit(dbFile(p, "base"))} AS base (READ_ONLY)`);

const step = async (what: string, sql: string) => {
  const t = performance.now();
  await db.run(sql);
  console.log(`  ${what} (${Math.round(performance.now() - t)} ms)`);
};

// ---------------------------------------------------------------- 1. records
await step("load records", `CREATE OR REPLACE TABLE raw AS SELECT * FROM ${source}`);

// Names that point to exactly one of our species, under any authority
await step(
  "name map",
  `CREATE OR REPLACE TABLE name_map AS
   SELECT sci_name, any_value(taxon_id) AS taxon_id FROM base.taxon_name
   WHERE sci_name IS NOT NULL GROUP BY 1 HAVING count(DISTINCT taxon_id) = 1`,
);

await step(
  "normalise and match",
  `CREATE OR REPLACE TABLE rec AS
   SELECT CAST(r.gbifid AS BIGINT) AS gbifid,
          r.datasetkey = ${lit(EBIRD)} AS is_ebird,
          coalesce(mv.taxon_id, mb.taxon_id) AS taxon_id,
          r.species, r.verbatimscientificname AS verbatim, r.taxonrank,
          TRY_CAST(left(CAST(r.eventdate AS VARCHAR), 10) AS DATE) AS d,
          TRY_CAST(r.decimallatitude AS DOUBLE) AS lat, TRY_CAST(r.decimallongitude AS DOUBLE) AS lon,
          r.eventid,
          array_to_string(list_sort(list_distinct(
            regexp_extract_all(CAST(r.recordedby AS VARCHAR), 'obsr[0-9]+'))), '|') AS observers,
          r.level2gid AS district, r.level2name AS district_name
   FROM raw r
   LEFT JOIN name_map mv ON mv.sci_name = r.verbatimscientificname
   LEFT JOIN name_map mb ON mb.sci_name = r.species`,
);

await step(
  "add weeks",
  `CREATE OR REPLACE TABLE rec AS
   SELECT *, year(d) AS yr,
          (month(d) - 1) * 4 + least(4, (day(d) - 1) // 7 + 1) AS week48
   FROM rec WHERE d IS NOT NULL`,
);

// ---------------------------------------------------------------- 2. checklists
// A shared group checklist appears once per observer, each copy with its own id but the
// same date, place and observer list. Collapse those copies into one sampling event.
await step(
  "checklists",
  `CREATE OR REPLACE TABLE list_map AS
   SELECT eventid,
          min(eventid) OVER (PARTITION BY d, round(lat, 4), round(lon, 4), observers) AS list_id
   FROM (SELECT DISTINCT eventid, d, lat, lon, observers FROM rec
         WHERE is_ebird AND eventid IS NOT NULL)`,
);
await step(
  "hits",
  `CREATE OR REPLACE TABLE hit AS
   SELECT DISTINCT m.list_id, r.taxon_id, r.d, r.yr, r.week48, r.district
   FROM rec r JOIN list_map m USING (eventid)
   WHERE r.is_ebird AND r.taxon_id IS NOT NULL`,
);
await step(
  "lists",
  `CREATE OR REPLACE TABLE list AS
   SELECT list_id, any_value(d) AS d, any_value(yr) AS yr, any_value(week48) AS week48,
          any_value(district) AS district, count(DISTINCT taxon_id) AS n_species
   FROM hit GROUP BY 1`,
);

// ---------------------------------------------------------------- 3. frequencies
await step(
  "weekly frequency, pooled over years",
  `CREATE OR REPLACE TABLE region_week AS
   WITH e AS (SELECT week48, count(*) AS n_lists FROM list GROUP BY 1),
        h AS (SELECT taxon_id, week48, count(*) AS n_hits FROM hit GROUP BY 1, 2),
        g AS (SELECT t.taxon_id, e.week48, e.n_lists, coalesce(h.n_hits, 0) AS n_hits
              FROM (SELECT DISTINCT taxon_id FROM hit) t CROSS JOIN e
              LEFT JOIN h ON h.taxon_id = t.taxon_id AND h.week48 = e.week48)
   SELECT *, n_hits / n_lists AS freq,
     -- Wilson 95% interval
     (n_hits / n_lists + 1.9208 / n_lists
       - 1.96 * sqrt((n_hits / n_lists) * (1 - n_hits / n_lists) / n_lists + 0.9604 / (n_lists * n_lists)))
       / (1 + 3.8416 / n_lists) AS freq_lo,
     (n_hits / n_lists + 1.9208 / n_lists
       + 1.96 * sqrt((n_hits / n_lists) * (1 - n_hits / n_lists) / n_lists + 0.9604 / (n_lists * n_lists)))
       / (1 + 3.8416 / n_lists) AS freq_hi
   FROM g`,
);
await step(
  "weekly frequency per year",
  `CREATE OR REPLACE TABLE year_week AS
   WITH e AS (SELECT yr, week48, count(*) AS n_lists FROM list GROUP BY 1, 2),
        h AS (SELECT taxon_id, yr, week48, count(*) AS n_hits FROM hit GROUP BY 1, 2, 3)
   SELECT t.taxon_id, e.yr, e.week48, e.n_lists, coalesce(h.n_hits, 0) AS n_hits,
          coalesce(h.n_hits, 0) / e.n_lists AS freq
   FROM (SELECT DISTINCT taxon_id FROM hit) t CROSS JOIN e
   LEFT JOIN h ON h.taxon_id = t.taxon_id AND h.yr = e.yr AND h.week48 = e.week48`,
);

// Species and their SoIB migratory parts
await step(
  "species status",
  `CREATE OR REPLACE TABLE sp AS
   SELECT c.taxon_id, c.en_name, c.migratory_status,
          list_sort(list(DISTINCT mp.part)) AS parts,
          (SELECT count(*) FROM hit WHERE hit.taxon_id = c.taxon_id) AS n_hits
   FROM base.current_species c
   LEFT JOIN base.species_migratory_part mp ON mp.taxon_id = c.taxon_id AND mp.release_id = 'soib-2026-v0'
   WHERE c.taxon_id IN (SELECT DISTINCT taxon_id FROM hit)
   GROUP BY 1, 2, 3`,
);

// ---------------------------------------------------------------- 4. phenology
// Winter migrants: season runs July (week 25) to June. Summer migrants: January to December.
// Per season: smooth weekly frequency over 3 weeks; arrival = first week at >= 50% of that
// season's peak; departure = last such week; first report = first week with any record.
await step(
  "phenology per season",
  `CREATE OR REPLACE TABLE season_week AS
   WITH m AS (
     SELECT taxon_id, CASE WHEN list_contains(parts, 'winter-migrant') THEN 'winter' ELSE 'summer' END AS kind
     FROM sp
     WHERE (list_contains(parts, 'winter-migrant') OR list_contains(parts, 'summer-migrant'))
       AND NOT list_contains(parts, 'resident') AND n_hits >= 30),
   w AS (
     SELECT y.taxon_id, m.kind, y.n_lists, y.n_hits, y.freq,
            CASE WHEN m.kind = 'winter' AND y.week48 >= 25 THEN y.yr
                 WHEN m.kind = 'winter' THEN y.yr - 1 ELSE y.yr END AS season,
            CASE WHEN m.kind = 'winter' THEN (y.week48 - 25 + 48) % 48 + 1 ELSE y.week48 END AS pos,
            y.week48
     FROM year_week y JOIN m USING (taxon_id))
   SELECT *, avg(CASE WHEN n_lists >= ${MIN_LISTS} THEN freq END)
               OVER (PARTITION BY taxon_id, season ORDER BY pos ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS f3
   FROM w`,
);
await step(
  "arrival and departure per season",
  `CREATE OR REPLACE TABLE season_pheno AS
   WITH s AS (
     SELECT taxon_id, kind, season,
            count(*) FILTER (WHERE n_lists >= ${MIN_LISTS}) AS weeks_ok,
            max(f3) AS peak,
            sum(n_hits) AS hits
     FROM season_week GROUP BY 1, 2, 3)
   SELECT s.*,
     (SELECT min(pos) FROM season_week w WHERE w.taxon_id = s.taxon_id AND w.season = s.season AND w.f3 >= 0.5 * s.peak) AS arrive_pos,
     (SELECT max(pos) FROM season_week w WHERE w.taxon_id = s.taxon_id AND w.season = s.season AND w.f3 >= 0.5 * s.peak) AS depart_pos,
     (SELECT min(pos) FROM season_week w WHERE w.taxon_id = s.taxon_id AND w.season = s.season AND w.n_hits > 0) AS first_pos
   FROM s
   -- a season counts only if most of its weeks were birded and the species was seen
   WHERE s.weeks_ok >= 40 AND s.peak > 0 AND s.hits >= 3`,
);

// ---------------------------------------------------------------- 5. backtest
// Forecast each of the last two seasons from the median of all earlier seasons.
// Pass = within 1 week (birding weeks are 7-10 days, so about +/- 7 days).
await step(
  "backtest",
  `CREATE OR REPLACE TABLE backtest AS
   WITH last2 AS (
     SELECT taxon_id, kind, season, arrive_pos, depart_pos, first_pos,
            row_number() OVER (PARTITION BY taxon_id ORDER BY season DESC) AS k
     FROM season_pheno)
   SELECT t.taxon_id, t.kind, t.season,
          t.arrive_pos, t.first_pos,
          (SELECT median(arrive_pos) FROM season_pheno h WHERE h.taxon_id = t.taxon_id AND h.season < t.season) AS pred_arrive,
          (SELECT median(first_pos) FROM season_pheno h WHERE h.taxon_id = t.taxon_id AND h.season < t.season) AS pred_first,
          (SELECT count(*) FROM season_pheno h WHERE h.taxon_id = t.taxon_id AND h.season < t.season) AS n_train
   FROM last2 t WHERE k <= 2`,
);

// ---------------------------------------------------------------- report
const q = (sql: string) => db.rows(sql);
const num = async (sql: string) => Number(await db.value(sql));
const table = (rows: Row[]): string => {
  const first = rows[0];
  if (!first) return "_none_\n";
  const cols = Object.keys(first);
  const f = (v: unknown) =>
    typeof v === "number" && !Number.isInteger(v) ? v.toFixed(3) : String(v ?? "");
  return [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => f(r[c]).replaceAll("|", "/")).join(" | ")} |`),
  ].join("\n");
};
/** Birding week position to a rough date label. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekLabel = (w: number) =>
  `${["1", "8", "15", "22"][(w - 1) % 4]} ${MONTHS[Math.floor((w - 1) / 4)]}`;
const posLabel = (kind: string, pos: number | null) =>
  pos == null ? "" : weekLabel(kind === "winter" ? ((pos - 1 + 24) % 48) + 1 : pos);

const totals = (
  await q(`SELECT
    (SELECT count(*) FROM raw) AS records,
    (SELECT count(*) FROM rec WHERE is_ebird) AS ebird_records,
    (SELECT count(*) FROM rec WHERE NOT is_ebird) AS other_records,
    (SELECT count(*) FROM rec WHERE taxon_id IS NOT NULL) AS matched,
    (SELECT count(*) FROM rec WHERE taxon_id IS NULL AND taxonrank IN ('SPECIES', 'SUBSPECIES')) AS unmatched_species_level,
    (SELECT count(*) FROM rec WHERE taxon_id IS NULL AND taxonrank NOT IN ('SPECIES', 'SUBSPECIES')) AS not_species_level,
    (SELECT count(DISTINCT eventid) FROM list_map) AS checklist_ids,
    (SELECT count(DISTINCT list_id) FROM list_map) AS sampling_events,
    (SELECT count(DISTINCT taxon_id) FROM hit) AS species,
    (SELECT min(d)::TEXT FROM rec) AS first_date, (SELECT max(d)::TEXT FROM rec) AS last_date`)
)[0] as Record<string, number | string>;

const unmatched = await q(`
  SELECT coalesce(verbatim, species) AS name, taxonrank, count(*)::INTEGER AS records FROM rec
  WHERE taxon_id IS NULL AND taxonrank IN ('SPECIES', 'SUBSPECIES')
  GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`);
const perYear = await q(`
  SELECT yr AS year, count(*)::INTEGER AS checklists, round(avg(n_species), 1) AS species_per_list
  FROM list GROUP BY 1 ORDER BY 1`);
const completeness = await q(`
  SELECT CASE WHEN n_species = 1 THEN '1 species' WHEN n_species < 5 THEN '2-4' WHEN n_species < 10 THEN '5-9'
              WHEN n_species < 20 THEN '10-19' ELSE '20+' END AS species_on_list,
         count(*)::INTEGER AS checklists, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
  FROM list GROUP BY 1 ORDER BY min(n_species)`);
const effortWeeks = await q(`
  SELECT min(n)::INTEGER AS fewest, round(median(n))::INTEGER AS median, max(n)::INTEGER AS most,
         count(*) FILTER (WHERE n < ${MIN_LISTS})::INTEGER AS weeks_below_min
  FROM (SELECT yr, week48, count(*) AS n FROM list GROUP BY 1, 2)`);
const districts = await q(`
  SELECT coalesce(any_value(r.district_name), l.district) AS district, count(*)::INTEGER AS checklists
  FROM list l LEFT JOIN (SELECT DISTINCT district, district_name FROM rec) r USING (district)
  GROUP BY l.district ORDER BY 2 DESC`);

// Seasonality sanity: winter migrants should be near zero in June-July; residents flat
const winterCheck = await q(`
  SELECT s.en_name AS species, s.n_hits::INTEGER AS records,
         round(max(freq), 3) AS peak_freq,
         round(avg(freq) FILTER (WHERE week48 BETWEEN 21 AND 28), 4) AS jun_jul_freq
  FROM region_week r JOIN sp s USING (taxon_id)
  WHERE list_contains(s.parts, 'winter-migrant') AND NOT list_contains(s.parts, 'resident')
  GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 12`);
const residentCheck = await q(`
  SELECT s.en_name AS species, s.n_hits::INTEGER AS records, round(avg(freq), 3) AS mean_freq,
         round(stddev_pop(freq) / nullif(avg(freq), 0), 2) AS variation
  FROM region_week r JOIN sp s USING (taxon_id)
  WHERE s.migratory_status = 'resident'
  GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 8`);

const pheno = await q(`
  SELECT s.en_name AS species, p.kind, count(*)::INTEGER AS seasons,
         median(p.first_pos) AS first_pos, median(p.arrive_pos) AS arrive_pos, median(p.depart_pos) AS depart_pos,
         round(stddev_samp(p.arrive_pos), 1) AS arrive_sd_weeks, round(median(p.peak), 3) AS peak_freq
  FROM season_pheno p JOIN sp s USING (taxon_id)
  GROUP BY 1, 2 ORDER BY 3 DESC, 8 DESC`);

const bt = await q(`
  SELECT s.en_name AS species, b.kind, b.season, b.n_train, b.pred_arrive, b.arrive_pos, b.pred_first, b.first_pos
  FROM backtest b JOIN sp s USING (taxon_id) WHERE b.n_train >= ${MIN_SEASONS} AND b.pred_arrive IS NOT NULL
  ORDER BY 1, 3`);
const migrants = await num(`
  SELECT count(*) FROM sp WHERE (list_contains(parts, 'winter-migrant') OR list_contains(parts, 'summer-migrant'))
    AND NOT list_contains(parts, 'resident')`);
const gate = (key: "arrive" | "first") => {
  const rows = bt.filter((r) => r[`pred_${key}`] != null && r[`${key}_pos`] != null);
  const bySpecies = new Map<string, boolean[]>();
  for (const r of rows) {
    const ok = Math.abs(Number(r[`pred_${key}`]) - Number(r[`${key}_pos`])) <= 1;
    bySpecies.set(String(r.species), [...(bySpecies.get(String(r.species)) ?? []), ok]);
  }
  const forecasts = rows.length;
  const hits = rows.filter(
    (r) => Math.abs(Number(r[`pred_${key}`]) - Number(r[`${key}_pos`])) <= 1,
  ).length;
  const speciesAll = [...bySpecies.values()].filter((v) => v.every(Boolean)).length;
  return { forecasts, hits, species: bySpecies.size, speciesAll };
};
const gArrive = gate("arrive");
const gFirst = gate("first");
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");

const md: string[] = [];
md.push(`# GBIF spike: ${label}\n`);
md.push(
  `Generated ${new Date().toISOString().slice(0, 10)} by \`pipeline/src/spike/gbif/analyse.ts\`. ` +
    "Records: GBIF, India birds 2015-2025, CC0 and CC BY only. Frequencies use eBird checklists only.\n",
);
md.push("## Records and matching\n");
md.push(table([totals as Row]));
md.push("\n**Unmatched species-level names** (top 15):\n");
md.push(table(unmatched));
md.push("\n## Checklists\n");
md.push(
  `GBIF's eBird records carry the checklist id (\`eventID\`). ${totals.checklist_ids} checklist ids collapse to ${totals.sampling_events} sampling events once shared group checklists are merged.\n`,
);
md.push(table(perYear));
md.push(
  "\n**Species per checklist** (a proxy for complete checklists; GBIF has no 'complete' flag):\n",
);
md.push(table(completeness));
md.push(`\n**Checklists per week of one year:**\n`);
md.push(table(effortWeeks));
md.push("\n**Checklists per district:**\n");
md.push(table(districts));
md.push("\n## Do the seasonal patterns make sense?\n");
md.push("Winter migrants (SoIB) should be near zero in June-July:\n");
md.push(table(winterCheck));
md.push("\nResidents should be roughly flat (variation = s.d. / mean of weekly frequency):\n");
md.push(table(residentCheck));
md.push("\n## Arrival and departure (median across seasons)\n");
md.push(
  "Arrival and departure = first and last week at 50% of the season's peak (3-week smoothed); first = first week with any report.\n",
);
md.push(
  table(
    pheno.map((r) => ({
      ...r,
      first: posLabel(String(r.kind), r.first_pos as number),
      arrive: posLabel(String(r.kind), r.arrive_pos as number),
      depart: posLabel(String(r.kind), r.depart_pos as number),
    })),
  ),
);
md.push("\n## Forecast gate backtest\n");
md.push(
  `Each of the last two seasons is predicted from the median of all earlier seasons (at least ${MIN_SEASONS}). Pass = within 1 birding week (about 7 days).\n`,
);
md.push(
  table([
    { measure: "Migrants in the data (SoIB winter or summer, not resident)", value: migrants },
    { measure: "Migrants with enough seasons to backtest", value: gArrive.species },
    {
      measure: "Arrival (50% of peak): forecasts within 1 week",
      value: `${gArrive.hits} / ${gArrive.forecasts} (${pct(gArrive.hits, gArrive.forecasts)})`,
    },
    {
      measure: "Arrival (50% of peak): species passing both seasons",
      value: `${gArrive.speciesAll} / ${gArrive.species} (${pct(gArrive.speciesAll, gArrive.species)})`,
    },
    {
      measure: "First report: forecasts within 1 week",
      value: `${gFirst.hits} / ${gFirst.forecasts} (${pct(gFirst.hits, gFirst.forecasts)})`,
    },
    {
      measure: "First report: species passing both seasons",
      value: `${gFirst.speciesAll} / ${gFirst.species} (${pct(gFirst.speciesAll, gFirst.species)})`,
    },
  ]),
);
md.push("\n**Every backtest forecast** (week positions within the season):\n");
md.push(table(bt));

const out = join(p.reportsDir, `spike-gbif-${name}.md`);
mkdirSync(p.reportsDir, { recursive: true });
writeFileSync(out, `${md.join("\n")}\n`);
console.log(`wrote ${out}`);
console.log(
  `gate: arrival ${pct(gArrive.speciesAll, gArrive.species)} of ${gArrive.species} species, first report ${pct(gFirst.speciesAll, gFirst.species)}`,
);
db.close();
