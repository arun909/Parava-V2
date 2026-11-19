import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type Paths, sourcesDir } from "./paths.ts";

export interface ReleaseEntry {
  release_id: string;
  source_id: string;
  version: string;
  published: string | null;
  status: "draft" | "final" | "superseded";
  /**
   * xlsx: a workbook file. csv: one CSV file. json-dir: a folder of API responses.
   * ebd: an eBird Basic Dataset folder (observation and sampling .txt files).
   * csv-dir: a folder with one CSV per sheet (test fixtures only; not checksummed).
   * columns-of: no file of its own; its data are columns inside another release's file.
   */
  format: "xlsx" | "csv" | "json-dir" | "ebd" | "csv-dir" | "columns-of";
  /** Path under .data/sources/. */
  file?: string;
  /** File checksum; for a folder, the checksum of every file's path and contents in order. */
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

/**
 * Absolute path to a release's file or folder, after checking it exists and matches its
 * checksum. A large folder with no checksum yet (a new eBird download) gets one computed and
 * printed, to add to sources.json.
 */
export async function verifiedFile(p: Paths, r: ReleaseEntry): Promise<string> {
  if (!r.file) throw new Error(`${r.release_id}: no file in sources.json`);
  const path = join(sourcesDir(p), r.file);
  if (!existsSync(path)) {
    throw new Error(`${r.release_id}: missing ${path}. See Part 2 of docs/Database.md.`);
  }
  const isDir = statSync(path).isDirectory();
  const wantDir = ["json-dir", "ebd", "csv-dir"].includes(r.format);
  if (isDir !== wantDir) {
    throw new Error(`${r.release_id}: ${path} should be a ${wantDir ? "folder" : "file"}`);
  }
  if (r.format === "csv-dir") return path;
  const actual = isDir ? await sha256Dir(path) : await sha256(path);
  if (!r.sha256 && r.format === "ebd") {
    console.log(`  ${r.release_id}: no checksum in sources.json; add "sha256": "${actual}"`);
  } else if (r.sha256 !== actual) {
    throw new Error(
      `${r.release_id}: checksum ${actual} does not match sources.json (${r.sha256})`,
    );
  }
  return path;
}

/** Streams the file, so multi-GB eBird files don't need to fit in memory. */
export async function sha256(path: string, h = new Bun.CryptoHasher("sha256")): Promise<string> {
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Checksum of a folder: every file's relative path and contents, in sorted order. */
export async function sha256Dir(dir: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for (const f of listFiles(dir)) {
    h.update(`${relative(dir, f)}\n`);
    for await (const chunk of createReadStream(f)) h.update(chunk as Buffer);
  }
  return h.digest("hex");
}

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? listFiles(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
    )
    .sort();
}
