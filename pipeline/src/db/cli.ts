/**
 * Species database commands.
 *
 *   bun run db:create                       create the three files, apply migrations
 *   bun run db:load <source> <release>      run one loader (e.g. india-checklist india-checklist-v10.1)
 *   bun run db:check                        every validation check; exits 1 on failure
 *   bun run db:report                       write docs/reports/db-<date>.md
 */
import { allChecks, errorsOf } from "./checks.ts";
import { Db } from "./duck.ts";
import { loadAvonet } from "./load/avonet.ts";
import {
  backupBase,
  csvFileWorkbook,
  csvWorkbook,
  inReleaseTransaction,
  rawFor,
  type Workbook,
  xlsxWorkbook,
} from "./load/common.ts";
import { loadEbd } from "./load/ebird-ebd.ts";
import { loadEbirdDistricts, loadHotspots } from "./load/ebird-regions.ts";
import { loadEbirdTaxonomy } from "./load/ebird-taxonomy.ts";
import { loadIndiaChecklist } from "./load/india-checklist.ts";
import { loadSoib } from "./load/soib.ts";
import { companions, findRelease, readManifest, verifiedFile } from "./manifest.ts";
import { migrateAll } from "./migrate.ts";
import { dbFile, defaultPaths, type Paths } from "./paths.ts";
import { writeReport } from "./report.ts";

/** Sources whose loader writes the base, inside one release transaction. */
const BASE_LOADERS = ["india-checklist", "soib", "ebird-tax", "avonet", "ebird-api"];

export async function load(
  p: Paths,
  sourceId: string,
  releaseId: string,
  log: (s: string) => void = console.log,
): Promise<string> {
  const manifest = readManifest(p);
  const r = findRelease(manifest, sourceId, releaseId);
  if (r.format === "columns-of") {
    throw new Error(`${releaseId} is loaded with ${r.of}; run db:load ${sourceId} ${r.of}`);
  }
  const file = await verifiedFile(p, r);
  await migrateAll(p, () => {});

  // The eBird Basic Dataset goes to the derived database only
  if (sourceId === "ebird-ebd") {
    await loadEbd(p, file, r, log);
    return "(base unchanged; no backup)";
  }
  if (!BASE_LOADERS.includes(sourceId)) throw new Error(`no loader for source ${sourceId} yet`);

  const wb: Workbook =
    r.format === "xlsx"
      ? xlsxWorkbook(file)
      : r.format === "csv"
        ? csvFileWorkbook(file)
        : csvWorkbook(file);
  const extra = companions(manifest, releaseId);
  const fileName = file.split("/").pop() ?? null;

  const db = await Db.open(dbFile(p, "base"));
  let releases: string[];
  try {
    await wb.prepare(db);
    await inReleaseTransaction(db, [r, ...extra], fileName, async () => {
      const raw = rawFor(p, r);
      if (sourceId === "india-checklist") await loadIndiaChecklist(db, wb, r, raw, log);
      else if (sourceId === "soib") await loadSoib(db, wb, r, extra, raw, log);
      else if (sourceId === "ebird-tax") await loadEbirdTaxonomy(db, wb, r, raw, log);
      else if (sourceId === "avonet") await loadAvonet(db, wb, r, raw, log);
      else if (sourceId === "ebird-api") await loadEbirdDistricts(db, file, r, log);
    });
    releases = (
      await db.rows<{ release_id: string }>("SELECT release_id FROM source_release ORDER BY 1")
    ).map((x) => x.release_id);
  } finally {
    db.close();
  }
  // Hotspots live in the derived database and need the districts committed first
  if (sourceId === "ebird-api") await loadHotspots(p, file, r, log);
  return backupBase(p, releases);
}

async function main(): Promise<number> {
  const p = defaultPaths();
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "create":
      await migrateAll(p);
      console.log("databases up to date");
      return 0;
    case "load": {
      const [source, release] = args;
      if (!source || !release) {
        console.error("usage: db:load <source> <release>");
        return 2;
      }
      console.log(`loading ${release}`);
      const backup = await load(p, source, release);
      console.log(`loaded ${release}; backup ${backup}`);
      return 0;
    }
    case "check": {
      const checks = await allChecks(p);
      for (const c of checks) {
        const mark = c.ok ? "pass" : c.level === "error" ? "FAIL" : c.level;
        console.log(`${mark.padEnd(5)} ${c.id}${c.detail ? `: ${c.detail}` : ""}`);
      }
      const errors = errorsOf(checks);
      console.log(errors.length ? `${errors.length} checks failed` : "all checks passed");
      return errors.length ? 1 : 0;
    }
    case "report":
      console.log(`wrote ${await writeReport(p)}`);
      return 0;
    default:
      console.error("usage: db:create | db:load <source> <release> | db:check | db:report");
      return 2;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
