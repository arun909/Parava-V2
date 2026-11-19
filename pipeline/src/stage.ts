export interface RunContext {
  /** Run id, e.g. "2026-12"; exports are written under `v/{runId}/`. */
  runId: string;
  /** Folder holding the DuckDB file and Parquet cache (gitignored). */
  dataDir: string;
}

export interface Stage {
  name: string;
  run(ctx: RunContext): Promise<void>;
}
