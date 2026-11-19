import { join } from "node:path";

export const DB_NAMES = ["base", "derived", "content"] as const;
export type DbName = (typeof DB_NAMES)[number];

export interface Paths {
  /** Gitignored working folder: databases, sources, raw copies, backups. */
  dataDir: string;
  /** Committed manifest of source files and their checksums. */
  manifestFile: string;
  /** Numbered migrations, one folder per database. */
  sqlDir: string;
  /** Where db:report writes its Markdown. */
  reportsDir: string;
}

const pipelineDir = new URL("../..", import.meta.url).pathname;

export function defaultPaths(): Paths {
  return {
    dataDir: process.env.PARAVA_DATA_DIR ?? join(pipelineDir, ".data"),
    manifestFile: join(pipelineDir, "sources.json"),
    sqlDir: join(pipelineDir, "sql"),
    reportsDir: join(pipelineDir, "..", "docs", "reports"),
  };
}

export const dbFile = (p: Paths, name: DbName): string =>
  join(p.dataDir, "db", `parava_${name}.duckdb`);
export const sourcesDir = (p: Paths): string => join(p.dataDir, "sources");
export const rawDir = (p: Paths, source: string, release: string): string =>
  join(p.dataDir, "raw", source, release);
export const backupsDir = (p: Paths): string => join(p.dataDir, "backups");
