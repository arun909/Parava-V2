import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Paths, sourcesDir } from "./paths.ts";

export interface ReleaseEntry {
  release_id: string;
  source_id: string;
  version: string;
  published: string | null;
  status: "draft" | "final" | "superseded";
  /**
   * xlsx: a workbook file. csv-dir: a folder with one CSV per sheet (test fixtures).
   * columns-of: no file of its own; its data are columns inside another release's file.
   */
  format: "xlsx" | "csv-dir" | "columns-of";
  /** Path under .data/sources/. */
  file?: string;
  sha256?: string | null;
  /** For columns-of: the release whose file carries this one. */
  of?: string;
  url?: string | null;
  notes?: string | null;
}

export interface Manifest {
  releases: ReleaseEntry[];
}

export function readManifest(p: Paths): Manifest {
  return JSON.parse(readFileSync(p.manifestFile, "utf8")) as Manifest;
}

export function findRelease(m: Manifest, sourceId: string, releaseId: string): ReleaseEntry {
  const r = m.releases.find((x) => x.release_id === releaseId && x.source_id === sourceId);
  if (!r) throw new Error(`sources.json has no release ${releaseId} for source ${sourceId}`);
  return r;
}

/** Releases carried as columns inside this release's file (e.g. soib-2020 inside soib-2026-v0). */
export const companions = (m: Manifest, releaseId: string): ReleaseEntry[] =>
  m.releases.filter((x) => x.format === "columns-of" && x.of === releaseId);

/** Absolute path to a release's file, after checking it exists and matches its checksum. */
export function verifiedFile(p: Paths, r: ReleaseEntry): string {
  if (!r.file) throw new Error(`${r.release_id}: no file in sources.json`);
  const path = join(sourcesDir(p), r.file);
  if (!existsSync(path)) {
    throw new Error(`${r.release_id}: missing ${path}. See Part 2 of docs/Database.md.`);
  }
  if (r.format === "xlsx") {
    const actual = sha256(path);
    if (r.sha256 !== actual) {
      throw new Error(
        `${r.release_id}: checksum ${actual} does not match sources.json (${r.sha256})`,
      );
    }
  } else if (!statSync(path).isDirectory()) {
    throw new Error(`${r.release_id}: ${path} should be a folder of CSV files`);
  }
  return path;
}

export function sha256(path: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}
