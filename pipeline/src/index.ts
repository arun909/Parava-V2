/**
 * Monthly pipeline. Stages run in order; if any stage fails the run stops
 * and the previous month's exports stay live.
 *
 *   bun run --filter @parava/pipeline run [stage...]
 */
import type { RunContext, Stage } from "./stage.ts";
import exportFiles from "./stages/export.ts";
import ingest from "./stages/ingest.ts";
import model from "./stages/model.ts";
import taxonomy from "./stages/taxonomy.ts";
import verify from "./stages/verify.ts";

const STAGES: Stage[] = [taxonomy, ingest, model, verify, exportFiles];

const ctx: RunContext = {
  runId: new Date().toISOString().slice(0, 7),
  dataDir: new URL("../.data/", import.meta.url).pathname,
};

const only = process.argv.slice(2);
const selected = only.length ? STAGES.filter((s) => only.includes(s.name)) : STAGES;

for (const stage of selected) {
  console.log(`[${ctx.runId}] ${stage.name}`);
  await stage.run(ctx);
}
