import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allChecks, errorsOf } from "./checks.ts";
import { load } from "./cli.ts";
import { Db, type Row } from "./duck.ts";
import { corrupt, SOIB_SHEETS, writeFixtures } from "./fixtures.ts";
import { migrateAll } from "./migrate.ts";
import { dbFile, defaultPaths, type Paths } from "./paths.ts";

// Each load reads 43 small sheets and runs every check
setDefaultTimeout(120_000);

const quiet = () => {};
let root: string;
let p: Paths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "parava-db-"));
  p = writeFixtures(root, defaultPaths().sqlDir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function query<T extends Row = Row>(sql: string): Promise<T[]> {
  const db = await Db.open(dbFile(p, "base"), { readOnly: true });
  try {
    return await db.rows<T>(sql);
  } finally {
    db.close();
  }
}
const count = async (sql: string) => Number(Object.values((await query(sql))[0] ?? {})[0]);

async function loadBoth() {
  await load(p, "india-checklist", "india-checklist-v10.1", quiet);
  await load(p, "soib", "soib-2026-v0", quiet);
}

describe("db:create", () => {
  test("builds three files from scratch, twice in a row", async () => {
    await migrateAll(p, quiet);
    await migrateAll(p, quiet);
    for (const name of ["base", "derived", "content"] as const) {
      const db = await Db.open(dbFile(p, name), { readOnly: true });
      expect(await db.count("SELECT count(*) FROM schema_migrations")).toBeGreaterThan(0);
      db.close();
    }
  });
});

describe("loading the fixtures", () => {
  test("loads the backbone, facts and every sheet, and passes every check", async () => {
    await loadBoth();
    expect(await count("SELECT count(*) FROM taxon")).toBe(10);
    expect(await count("SELECT max(taxon_id) = 'pv00010' FROM taxon")).toBe(1);
    expect(await count("SELECT count(*) FROM taxon_order")).toBe(2);
    expect(await count("SELECT count(*) FROM taxon_family WHERE en_name IS NOT NULL")).toBe(2);
    expect(await count("SELECT count(*) FROM taxon_name WHERE authority = 'soib-v7.1'")).toBe(10);
    expect(await count("SELECT count(*) FROM checklist_appendix")).toBe(2);
    expect(await count("SELECT count(*) FROM species_endemic_region")).toBe(1);
    // India 10 + Kerala 10 + 40 other sheets x 2
    expect(await count("SELECT count(*) FROM assessment WHERE release_id = 'soib-2026-v0'")).toBe(
      10 + 10 + (SOIB_SHEETS.length - 1) * 2,
    );
    expect(await count("SELECT count(*) FROM assessment WHERE release_id = 'soib-2020'")).toBe(6);
    const checks = await allChecks(p);
    expect(errorsOf(checks)).toEqual([]);
  });

  test("matches on the 2025 checklist name, never the shared v7.1 name", async () => {
    await loadBoth();
    // Species 2 and 3 share the v7.1 scientific name; each must keep its own facts
    const rows = await query<{ taxon_id: string; migratory_status: string }>(
      "SELECT taxon_id, migratory_status FROM species_india_status WHERE release_id = 'soib-2026-v0' AND taxon_id IN ('pv00002', 'pv00003') ORDER BY 1",
    );
    expect(rows).toEqual([
      { taxon_id: "pv00002", migratory_status: "resident-and-altitudinal-migrant" },
      { taxon_id: "pv00003", migratory_status: "winter-migrant-extirpated" },
    ]);
    expect(
      await count(
        "SELECT count(*) FROM species_migratory_part WHERE taxon_id = 'pv00003' AND part = 'winter-migrant' AND extirpated",
      ),
    ).toBe(1);
  });

  test("converts values: fractions, booleans, family names, missing columns as NULL", async () => {
    await loadBoth();
    expect(
      await count(
        "SELECT share_global_range_frac FROM species_population WHERE taxon_id = 'pv00001'",
      ),
    ).toBe(0.25);
    expect(
      await count("SELECT en_name = 'Pittas' FROM taxon_family WHERE family_id = 'pittidae'"),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) FROM assessment WHERE scope_code = 'IN-AP' AND lt_mean_pct IS NULL AND cat_mean_pct IS NOT NULL",
      ),
    ).toBe(2);
    expect(
      await count("SELECT count(*) FROM assessment WHERE scope_code = 'IN-KL' AND is_key_species"),
    ).toBe(1);
    expect(await count("SELECT count(*) FROM species_extra WHERE key = 'selected_nrl'")).toBe(8);
  });

  test("current_species takes legal status from the checklist and status from SoIB", async () => {
    await loadBoth();
    const [row] = await query<Record<string, unknown>>(
      "SELECT iucn, migratory_status, endemic_india, vagrant, priority FROM current_species WHERE taxon_id = 'pv00001'",
    );
    expect(row).toEqual({
      iucn: "LC",
      migratory_status: "resident",
      endemic_india: true,
      vagrant: false,
      priority: "high",
    });
  });

  test("reloading a release replaces its rows", async () => {
    await loadBoth();
    const before = await count("SELECT count(*) FROM assessment");
    await load(p, "soib", "soib-2026-v0", quiet);
    expect(await count("SELECT count(*) FROM assessment")).toBe(before);
  });
});

describe("refusing bad files", () => {
  test("an unknown category stops the load and leaves the base untouched", async () => {
    await loadBoth();
    const before = await count("SELECT count(*) FROM assessment");
    corrupt(p, "India", "Diet Guild", 0, "Moonbeams");
    await expect(load(p, "soib", "soib-2026-v0", quiet)).rejects.toThrow(
      /Moonbeams.*not in lookup 'diet'/,
    );
    expect(await count("SELECT count(*) FROM assessment")).toBe(before);
  });

  test("a species no one knows stops the load", async () => {
    await load(p, "india-checklist", "india-checklist-v10.1", quiet);
    corrupt(p, "Kerala", "India.Checklist.Scientific.Name.2025", 0, "Nonexistus birdus");
    await expect(load(p, "soib", "soib-2026-v0", quiet)).rejects.toThrow(
      /Kerala.*Nonexistus birdus/,
    );
    expect(await count("SELECT count(*) FROM assessment")).toBe(0);
  });

  test("SoIB before the checklist is refused", async () => {
    await expect(load(p, "soib", "soib-2026-v0", quiet)).rejects.toThrow(
      /load the India checklist first/,
    );
  });

  test("a number that isn't one stops the load", async () => {
    await load(p, "india-checklist", "india-checklist-v10.1", quiet);
    corrupt(p, "India", "Generation Length", 4, "about five");
    await expect(load(p, "soib", "soib-2026-v0", quiet)).rejects.toThrow(
      /Generation Length.*not num/,
    );
  });
});
