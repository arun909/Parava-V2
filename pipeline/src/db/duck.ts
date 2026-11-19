import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export type Row = Record<string, unknown>;

/** A thin wrapper over one DuckDB connection. */
export class Db {
  private constructor(
    private readonly instance: DuckDBInstance,
    readonly conn: DuckDBConnection,
  ) {}

  static async open(path: string, opts: { readOnly?: boolean } = {}): Promise<Db> {
    const options: Record<string, string> = opts.readOnly ? { access_mode: "READ_ONLY" } : {};
    const instance = await DuckDBInstance.create(path, options);
    return new Db(instance, await instance.connect());
  }

  async run(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  async rows<T extends Row = Row>(sql: string): Promise<T[]> {
    const reader = await this.conn.runAndReadAll(sql);
    return reader.getRowObjectsJson() as T[];
  }

  /** The first column of the first row, or undefined. */
  async value(sql: string): Promise<unknown> {
    const [row] = await this.rows(sql);
    return row ? Object.values(row)[0] : undefined;
  }

  async count(sql: string): Promise<number> {
    return Number(await this.value(sql));
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }
}

/** A SQL string literal. */
export const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** A quoted SQL identifier. */
export const ident = (s: string): string => `"${s.replaceAll('"', '""')}"`;

/** A source cell as text, with blanks as NULL; `alias` qualifies the column (e.g. "x"). */
export const nz = (col: string, alias?: string): string =>
  `NULLIF(trim(${alias ? `${alias}.` : ""}${ident(col)}), '')`;
