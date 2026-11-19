/**
 * Build-time access to species data exported by `bun run db:export-site`.
 * Reads site/.data/; if it's missing, pages build empty and say how to fill it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Code, Lookups, SpeciesDetail, SpeciesSummary } from "@parava/shared";

const dataDir = join(process.cwd(), ".data");

function readJson<T>(path: string, fallback: T): T {
  const file = join(dataDir, path);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

export const hasData = (): boolean => existsSync(join(dataDir, "species", "index.json"));

let index: SpeciesSummary[] | undefined;
export function speciesIndex(): SpeciesSummary[] {
  index ??= readJson<SpeciesSummary[]>("species/index.json", []);
  return index;
}

export function speciesDetail(slug: string): SpeciesDetail {
  return readJson<SpeciesDetail>(`species/${slug}.json`, undefined as never);
}

let lookups: Lookups | undefined;
/** The display label for a lookup code; falls back to the code itself. */
export function label(scheme: string, code: Code | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  lookups ??= readJson<Lookups>("lookups.json", {});
  return lookups[scheme]?.[code] ?? code;
}
