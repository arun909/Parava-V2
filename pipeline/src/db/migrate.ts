import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Db, lit } from "./duck.ts";
import { DB_NAMES, type DbName, dbFile, type Paths } from "./paths.ts";

/** Numbered .sql files for one database, in order. */
export function migrationFiles(p: Paths, name: DbName): string[] {
  const dir = join(p.sqlDir, name);
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

/** Create any missing database files and apply pending migrations, each in its own transaction. */
export async function migrateAll(p: Paths, log: (s: string) => void = console.log): Promise<void> {
  for (const name of DB_NAMES) {
    const file = dbFile(p, name);
    mkdirSync(dirname(file), { recursive: true });
    const db = await Db.open(file);
    try {
      await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL)`);
      const done = new Set(
        (await db.rows<{ version: string }>("SELECT version FROM schema_migrations")).map(
          (r) => r.version,
        ),
      );
      for (const f of migrationFiles(p, name)) {
        if (done.has(f)) continue;
        const sql = readFileSync(join(p.sqlDir, name, f), "utf8");
        await db.run("BEGIN TRANSACTION");
        try {
          await db.run(sql);
          await db.run(
            `INSERT INTO schema_migrations VALUES (${lit(f)}, current_timestamp::TIMESTAMP)`,
          );
          await db.run("COMMIT");
        } catch (e) {
          await db.run("ROLLBACK");
          throw new Error(`${name}/${f}: ${(e as Error).message}`);
        }
        log(`  ${name}: applied ${f}`);
      }
    } finally {
      db.close();
    }
  }
}
