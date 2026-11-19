/**
 * Fetch eBird reference data through the eBird API 2.0 (needs EBIRD_API_KEY in pipeline/.env):
 * taxonomy, India's states and districts, species ever recorded per state, hotspots per state.
 * The API has no history beyond 30 days, so this is reference data only.
 *
 *   bun --env-file=pipeline/.env pipeline/src/spike/ebird/fetch-reference.ts
 *
 * Writes .data/sources/ebird-api/<YYYY-MM-DD>/ (raw responses, as returned).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../../db/paths.ts";

const KEY = process.env.EBIRD_API_KEY;
if (!KEY) {
  console.error("EBIRD_API_KEY is not set. Run with: bun --env-file=pipeline/.env ...");
  process.exit(2);
}
const API = "https://api.ebird.org/v2";
const day = new Date().toISOString().slice(0, 10);
const dir = join(defaultPaths().dataDir, "sources", "ebird-api", day);
mkdirSync(dir, { recursive: true });

/** One request at a time, at most one per second (eBird's guidance). */
let last = 0;
async function get(path: string): Promise<string> {
  const wait = last + 1000 - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  for (let attempt = 1; ; attempt++) {
    last = Date.now();
    const res = await fetch(`${API}/${path}`, { headers: { "X-eBirdApiToken": KEY as string } });
    if (res.ok) return res.text();
    if (attempt >= 3 || res.status === 403) throw new Error(`${path}: HTTP ${res.status}`);
    await Bun.sleep(3000 * attempt);
  }
}
const save = (file: string, body: string) => {
  writeFileSync(join(dir, file), body);
  return body;
};

console.log(`writing to ${dir}`);
save("taxonomy.csv", await get("ref/taxonomy/ebird?fmt=csv&locale=en"));
save("taxonomy-versions.json", await get("ref/taxonomy/versions"));
console.log("  taxonomy");

const states = JSON.parse(save("states.json", await get("ref/region/list/subnational1/IN"))) as {
  code: string;
  name: string;
}[];
const districts = JSON.parse(
  save("districts.json", await get("ref/region/list/subnational2/IN")),
) as unknown[];
console.log(`  ${states.length} states, ${districts.length} districts`);

mkdirSync(join(dir, "spplist"), { recursive: true });
mkdirSync(join(dir, "hotspots"), { recursive: true });
for (const s of states) {
  const spp = JSON.parse(
    save(join("spplist", `${s.code}.json`), await get(`product/spplist/${s.code}`)),
  ) as string[];
  const hot = JSON.parse(
    save(join("hotspots", `${s.code}.json`), await get(`ref/hotspot/${s.code}?fmt=json`)),
  ) as unknown[];
  console.log(`  ${s.code} ${s.name}: ${spp.length} species, ${hot.length} hotspots`);
}
console.log("done");
