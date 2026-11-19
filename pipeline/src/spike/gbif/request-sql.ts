/**
 * Spike: request a GBIF SQL download for one or more states, wait for it, download it.
 * Needs a free GBIF account in pipeline/.env:  GBIF_USER=...  GBIF_PASSWORD=...
 *
 *   bun pipeline/src/spike/gbif/request-sql.ts kerala IND.17_1
 *   bun pipeline/src/spike/gbif/request-sql.ts --key 0012345-261101123456789 kerala   (resume)
 *
 * Writes .data/spike/raw/<name>.tsv (unzipped) and <name>.download.json (key, DOI, query).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../../db/paths.ts";

const API = "https://api.gbif.org/v1/occurrence/download";
const args = process.argv.slice(2);
let key: string | undefined;
if (args[0] === "--key") {
  key = args[1];
  args.splice(0, 2);
}
const [name, ...gadmIds] = args;
if (!name || (!key && gadmIds.length === 0)) {
  console.error(
    "usage: request-sql.ts <name> <gadm level-1 id>...   |   --key <download key> <name>",
  );
  process.exit(2);
}

const user = process.env.GBIF_USER;
const password = process.env.GBIF_PASSWORD;
if (!user || !password) {
  console.error("Set GBIF_USER and GBIF_PASSWORD in pipeline/.env (a free gbif.org account).");
  process.exit(2);
}
const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

// The 8 columns the spike needs, plus the verbatim name (the eBird name for eBird records)
export const sqlFor = (ids: string[]): string =>
  [
    "SELECT gbifid, datasetkey, species, verbatimscientificname, taxonrank, eventdate,",
    "  decimallatitude, decimallongitude, eventid, recordedby, level2gid, level2name, license",
    "FROM occurrence",
    `WHERE level1gid IN (${ids.map((g) => `'${g}'`).join(", ")})`,
    "  AND classkey = 212",
    '  AND "year" >= 2015 AND "year" <= 2025',
    "  AND occurrencestatus = 'PRESENT'",
    "  AND hascoordinate = TRUE",
    "  AND license IN ('CC0_1_0', 'CC_BY_4_0')",
  ].join("\n");

const dir = join(defaultPaths().dataDir, "spike", "raw");
mkdirSync(dir, { recursive: true });

if (!key) {
  const sql = sqlFor(gadmIds);
  const res = await fetch(`${API}/request`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ sendNotification: true, format: "SQL_TSV_ZIP", sql }),
  });
  const text = await res.text();
  if (res.status !== 201) {
    console.error(`GBIF refused the request (HTTP ${res.status}): ${text}`);
    process.exit(1);
  }
  key = text.trim();
  writeFileSync(join(dir, `${name}.download.json`), JSON.stringify({ key, sql }, null, 2));
  console.log(`requested download ${key}; GBIF also emails you when it's ready`);
}

// Poll until ready
let meta: {
  status: string;
  doi?: string;
  downloadLink?: string;
  totalRecords?: number;
  size?: number;
};
for (;;) {
  const res = await fetch(`${API}/${key}`);
  meta = (await res.json()) as typeof meta;
  console.log(`  ${new Date().toISOString().slice(11, 19)} ${meta.status}`);
  if (meta.status === "SUCCEEDED") break;
  if (["FAILED", "KILLED", "CANCELLED", "SUSPENDED"].includes(meta.status)) {
    console.error(`download ${key} ended as ${meta.status}`);
    process.exit(1);
  }
  await Bun.sleep(60_000);
}

console.log(
  `ready: ${meta.totalRecords} records, ${Math.round((meta.size ?? 0) / 1e6)} MB, DOI ${meta.doi}`,
);
const zip = join(dir, `${name}.zip`);
const res = await fetch(meta.downloadLink ?? `${API}/request/${key}.zip`);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
await Bun.write(zip, res);
writeFileSync(
  join(dir, `${name}.download.json`),
  JSON.stringify({ key, doi: meta.doi, totalRecords: meta.totalRecords }, null, 2),
);

// The zip holds one TSV; unzip it to <name>.tsv
const proc = Bun.spawnSync(["unzip", "-o", "-p", zip], {
  stdout: Bun.file(join(dir, `${name}.tsv`)),
});
if (proc.exitCode !== 0) throw new Error(`unzip failed: ${proc.stderr.toString()}`);
console.log(`wrote ${join(dir, `${name}.tsv`)}`);
