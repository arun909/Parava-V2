/**
 * Spike: fetch every GBIF bird record for one state through the public search API
 * (no account needed). Only for small states: the API stops paging at 100,000 records.
 * Large states use the SQL download instead (request-sql.ts).
 *
 *   bun pipeline/src/spike/gbif/fetch-search.ts IND.23_1 mizoram
 *
 * Writes .data/spike/raw/<name>.jsonl, one record per line, with the same 8 columns
 * the SQL download asks for (plus names and licence for checking).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../../db/paths.ts";

const [gadm, name] = process.argv.slice(2);
if (!gadm || !name) {
  console.error("usage: fetch-search.ts <gadm level-1 id, e.g. IND.23_1> <name>");
  process.exit(2);
}

const API = "https://api.gbif.org/v1/occurrence/search";
const PAGE = 300;
const params = new URLSearchParams({
  gadmGid: gadm,
  taxonKey: "212", // Aves
  year: "2015,2025",
  occurrenceStatus: "PRESENT",
  hasCoordinate: "true",
  limit: String(PAGE),
});
// Openly licensed records only (no non-commercial)
params.append("license", "CC0_1_0");
params.append("license", "CC_BY_4_0");

interface GbifRecord {
  key: number;
  datasetKey: string;
  species?: string;
  speciesKey?: number;
  taxonRank?: string;
  eventDate?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  eventID?: string;
  recordedBy?: string;
  locality?: string;
  gadm?: { level2?: { gid?: string; name?: string } };
  license?: string;
}

async function page(
  offset: number,
): Promise<{ count: number; endOfRecords: boolean; results: GbifRecord[] }> {
  const url = `${API}?${params}&offset=${offset}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "parava-pipeline/0.0 (spike)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { count: number; endOfRecords: boolean; results: GbifRecord[] };
    } catch (e) {
      if (attempt >= 5) throw e;
      await Bun.sleep(2000 * attempt);
    }
  }
}

const first = await page(0);
if (first.count > 100_000) {
  console.error(`${first.count} records: too many for the search API. Use request-sql.ts.`);
  process.exit(1);
}
console.log(`${gadm}: ${first.count} records`);

const lines: string[] = [];
const keep = (r: GbifRecord) =>
  JSON.stringify({
    gbifid: r.key,
    datasetkey: r.datasetKey,
    species: r.species ?? null,
    taxonrank: r.taxonRank ?? null,
    eventdate: r.eventDate?.slice(0, 10) ?? null,
    decimallatitude: r.decimalLatitude ?? null,
    decimallongitude: r.decimalLongitude ?? null,
    eventid: r.eventID ?? null,
    recordedby: r.recordedBy ?? null,
    level2gid: r.gadm?.level2?.gid ?? null,
    level2name: r.gadm?.level2?.name ?? null,
    license: r.license ?? null,
  });

let offset = 0;
let current = first;
for (;;) {
  for (const r of current.results) lines.push(keep(r));
  offset += PAGE;
  if (current.endOfRecords || offset >= first.count) break;
  if (offset % 6000 === 0) console.log(`  ${offset} / ${first.count}`);
  await Bun.sleep(150); // be polite to GBIF
  current = await page(offset);
}

const dir = join(defaultPaths().dataDir, "spike", "raw");
mkdirSync(dir, { recursive: true });
const out = join(dir, `${name}.jsonl`);
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} records to ${out}`);
