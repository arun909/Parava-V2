/**
 * Browse the three databases in DuckDB's local UI (http://localhost:4213).
 * Everything is attached read-only, so nothing here can change the data.
 *
 *   bun run db:ui        then open http://localhost:4213; Ctrl+C to stop
 */
import { Db, lit } from "./duck.ts";
import { DB_NAMES, dbFile, defaultPaths } from "./paths.ts";

const p = defaultPaths();
const db = await Db.open(":memory:");
for (const name of DB_NAMES) {
  await db.run(`ATTACH ${lit(dbFile(p, name))} AS ${name} (READ_ONLY)`);
}
await db.run("USE base");
await db.run("INSTALL ui; LOAD ui;");
const [row] = await db.rows("CALL start_ui_server()");
console.log(Object.values(row ?? {}).join(" "));
console.log(
  "Open http://localhost:4213 — databases: base, derived, content (read-only). Ctrl+C to stop.",
);

// Keep the process (and the UI server inside it) alive
setInterval(() => {}, 1 << 30);
