import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cell25 } from "@parava/shared";
import { allChecks, errorsOf } from "./checks.ts";
import { load } from "./cli.ts";
import { Db, type Row } from "./duck.ts";
import { SPECIES, writeFixtures } from "./fixtures.ts";
import { type Manifest, sha256, sha256Dir } from "./manifest.ts";
import { dbFile, defaultPaths, type Paths } from "./paths.ts";

// Each test loads the checklist and SoIB fixtures first (43 small sheets)
setDefaultTimeout(180_000);

const quiet = () => {};
let root: string;
let p: Paths;
let src: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "parava-ebird-"));
  p = writeFixtures(root, defaultPaths().sqlDir);
  src = join(p.dataDir, "sources");
  await load(p, "india-checklist", "india-checklist-v10.1", quiet);
  await load(p, "soib", "soib-2026-v0", quiet);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function query<T extends Row = Row>(file: "base" | "derived", sql: string): Promise<T[]> {
  const db = await Db.open(dbFile(p, file), { readOnly: true });
  try {
    return await db.rows<T>(sql);
  } finally {
    db.close();
  }
}
const one = async (file: "base" | "derived", sql: string) =>
  Object.values((await query(file, sql))[0] ?? {})[0];

function addRelease(entry: Manifest["releases"][number]): void {
  const m = JSON.parse(readFileSync(p.manifestFile, "utf8")) as Manifest;
  m.releases.push(entry);
  writeFileSync(p.manifestFile, JSON.stringify(m, null, 2));
}
const csv = (rows: string[][]) =>
  `${rows.map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;

// ---------------------------------------------------------------- eBird taxonomy
async function writeTaxonomy(
  rows = SPECIES.map((s, i) => [s.sci, s.en, `fixsp${i + 1}`, "species"]),
) {
  const dir = join(src, "ebird-tax", "fixture");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "taxonomy.csv");
  const header = [
    "SCIENTIFIC_NAME",
    "COMMON_NAME",
    "SPECIES_CODE",
    "CATEGORY",
    "TAXON_ORDER",
    "FAMILY_SCI_NAME",
    "FAMILY_COM_NAME",
  ];
  writeFileSync(
    file,
    csv([
      header,
      ...rows.map((r, i) => [...r, String(i + 1), "Fixturidae", "Fixtures"]),
      [
        "Fixtura synthetica1 alba",
        "Synthetic Bird 1 (White)",
        "fixsp1a",
        "issf",
        "99",
        "Fixturidae",
        "Fixtures",
      ],
      ["Fixtura sp.", "fixture sp.", "fixspuh", "spuh", "100", "Fixturidae", "Fixtures"],
    ]),
  );
  addRelease({
    release_id: "ebird-tax-2025",
    source_id: "ebird-tax",
    version: "fixture",
    published: null,
    status: "final",
    format: "csv",
    file: "ebird-tax/fixture/taxonomy.csv",
    sha256: await sha256(file),
  });
}

describe("eBird taxonomy", () => {
  test("gives every species exactly one eBird code", async () => {
    await writeTaxonomy();
    await load(p, "ebird-tax", "ebird-tax-2025", quiet);
    expect(await one("base", "SELECT count(*) FROM taxon_xref WHERE system = 'ebird'")).toBe("10");
    expect(
      await one(
        "base",
        "SELECT external_id FROM taxon_xref WHERE system = 'ebird' AND taxon_id = 'pv00003'",
      ),
    ).toBe("fixsp3");
    expect(errorsOf(await allChecks(p))).toEqual([]);
  });

  test("refuses a taxonomy that leaves a species without a code", async () => {
    await writeTaxonomy(
      SPECIES.slice(0, 9).map((s, i) => [s.sci, s.en, `fixsp${i + 1}`, "species"]),
    );
    await expect(load(p, "ebird-tax", "ebird-tax-2025", quiet)).rejects.toThrow(
      /don't match exactly one/,
    );
    expect(await one("base", "SELECT count(*) FROM taxon_xref WHERE system = 'ebird'")).toBe("0");
  });
});

// ---------------------------------------------------------------- AVONET
const AVONET_TRAITS = [
  "Beak.Length_Culmen",
  "Beak.Length_Nares",
  "Beak.Width",
  "Beak.Depth",
  "Tarsus.Length",
  "Wing.Length",
  "Kipps.Distance",
  "Hand-Wing.Index",
  "Tail.Length",
  "Mass",
  "Mass.Source",
  "Inference",
  "Habitat",
  "Habitat.Density",
  "Migration",
  "Trophic.Level",
  "Trophic.Niche",
  "Primary.Lifestyle",
];
const trait = (i: number) => [
  "20",
  "15",
  "8",
  "9",
  "30",
  String(100 + i),
  "40",
  "25",
  "70",
  String(50 + i),
  "Dunning",
  "NO",
  i === 0 ? "NA" : "Forest",
  "1",
  "2",
  "Carnivore",
  "Invertivore",
  "Insessorial",
];

function writeAvonet(ebirdSpecies: number[], birdlifeSpecies: number[]) {
  const dir = join(src, "avonet", "fixture");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "AVONET2_eBird.csv"),
    csv([
      ["Species2", "Avibase.ID2", ...AVONET_TRAITS],
      ...ebirdSpecies.map((i) => [SPECIES[i]?.sci ?? "", "AVIBASE-NONE", ...trait(i)]),
    ]),
  );
  // BirdLife sheet: matched by Avibase id (as SoIB carries it), with an unknown name
  writeFileSync(
    join(dir, "AVONET1_BirdLife.csv"),
    csv([
      ["Species1", "Avibase.ID1", ...AVONET_TRAITS],
      ...birdlifeSpecies.map((i) => ["Otherus nomen", `avibase-${i + 1}`, ...trait(i)]),
    ]),
  );
  addRelease({
    release_id: "avonet-1.0",
    source_id: "avonet",
    version: "fixture",
    published: null,
    status: "final",
    format: "csv-dir",
    file: "avonet/fixture",
  });
}

describe("AVONET", () => {
  test("matches by eBird name first, then Avibase id, and treats NA as blank", async () => {
    writeAvonet([0, 1, 2, 3, 4, 5, 6, 7], [8, 9]);
    await load(p, "avonet", "avonet-1.0", quiet);
    expect(await one("base", "SELECT count(*) FROM species_morphology")).toBe("10");
    expect(
      await one("base", "SELECT mass_g FROM species_morphology WHERE taxon_id = 'pv00004'"),
    ).toBe(53);
    expect(
      await one(
        "base",
        "SELECT value_text FROM species_extra WHERE key = 'avonet_match' AND taxon_id = 'pv00010'",
      ),
    ).toBe("birdlife-sheet:avibase");
    expect(
      await one(
        "base",
        "SELECT count(*) FROM species_extra WHERE key = 'avonet_habitat' AND taxon_id = 'pv00001'",
      ),
    ).toBe("0");
    expect(
      await one(
        "base",
        "SELECT trophic_level FROM species_ecology WHERE release_id = 'avonet-1.0' AND taxon_id = 'pv00001'",
      ),
    ).toBe("carnivore");
    expect(errorsOf(await allChecks(p))).toEqual([]);
  });

  test("refuses to load when under 95% of species match", async () => {
    writeAvonet([0, 1, 2, 3, 4, 5, 6, 7], []);
    await expect(load(p, "avonet", "avonet-1.0", quiet)).rejects.toThrow(
      /only 8 of 10 species matched/,
    );
  });
});

// ---------------------------------------------------------------- districts and hotspots
async function writeEbirdApi() {
  const dir = join(src, "ebird-api", "fixture");
  mkdirSync(join(dir, "hotspots"), { recursive: true });
  const states = await query<{ code: string; name: string }>(
    "base",
    "SELECT scope_code AS code, name_en AS name FROM scope WHERE kind = 'state'",
  );
  writeFileSync(join(dir, "states.json"), JSON.stringify(states));
  writeFileSync(
    join(dir, "districts.json"),
    JSON.stringify([
      { code: "IN-KL-ER", name: "Ernakulam" },
      { code: "IN-KL-WA", name: "Wayanad" },
      { code: "IN-MZ-AI", name: "Aizawl" },
    ]),
  );
  writeFileSync(
    join(dir, "hotspots", "IN-KL.json"),
    JSON.stringify([
      {
        locId: "L1",
        locName: "Thattekad",
        subnational1Code: "IN-KL",
        subnational2Code: "IN-KL-ER",
        lat: 10.13,
        lng: 76.7,
        latestObsDt: "2026-11-01 07:00",
        numSpeciesAllTime: 300,
        numChecklistsAllTime: 5000,
      },
      { locId: "L2", locName: "No district", subnational1Code: "IN-KL", lat: 9.5, lng: 76.3 },
    ]),
  );
  addRelease({
    release_id: "ebird-api-fixture",
    source_id: "ebird-api",
    version: "fixture",
    published: null,
    status: "final",
    format: "json-dir",
    file: "ebird-api/fixture",
    sha256: await sha256Dir(dir),
  });
}

describe("eBird districts and hotspots", () => {
  test("adds districts under their states and places hotspots in them", async () => {
    await writeEbirdApi();
    await load(p, "ebird-api", "ebird-api-fixture", quiet);
    expect(await one("base", "SELECT parent_code FROM scope WHERE scope_code = 'IN-KL-ER'")).toBe(
      "IN-KL",
    );
    const sites = await query(
      "derived",
      "SELECT site_id, scope_code, cell25, n_species_all_time FROM site ORDER BY 1",
    );
    expect(sites).toEqual([
      {
        site_id: "L1",
        scope_code: "IN-KL-ER",
        cell25: cell25(10.13, 76.7),
        n_species_all_time: 300,
      },
      { site_id: "L2", scope_code: "IN-KL", cell25: cell25(9.5, 76.3), n_species_all_time: null },
    ]);
    expect(errorsOf(await allChecks(p))).toEqual([]);
  });
});

// ---------------------------------------------------------------- eBird Basic Dataset
const SAMPLING_HEADER = [
  "LAST EDITED DATE",
  "COUNTRY",
  "COUNTRY CODE",
  "STATE",
  "STATE CODE",
  "COUNTY",
  "COUNTY CODE",
  "LOCALITY",
  "LOCALITY ID",
  "LOCALITY TYPE",
  "LATITUDE",
  "LONGITUDE",
  "OBSERVATION DATE",
  "TIME OBSERVATIONS STARTED",
  "OBSERVER ID",
  "SAMPLING EVENT IDENTIFIER",
  "PROTOCOL TYPE",
  "DURATION MINUTES",
  "EFFORT DISTANCE KM",
  "NUMBER OBSERVERS",
  "ALL SPECIES REPORTED",
  "GROUP IDENTIFIER",
  "CHECKLIST COMMENTS",
];
const OBS_HEADER = [
  "GLOBAL UNIQUE IDENTIFIER",
  "TAXONOMIC ORDER",
  "CATEGORY",
  "TAXON CONCEPT ID",
  "COMMON NAME",
  "SCIENTIFIC NAME",
  "SUBSPECIES SCIENTIFIC NAME",
  "EXOTIC CODE",
  "OBSERVATION COUNT",
  "STATE CODE",
  "OBSERVATION DATE",
  "SAMPLING EVENT IDENTIFIER",
  "APPROVED",
  "REVIEWED",
];
// EBD lines end with a trailing tab
const tsv = (header: string[], rows: Record<string, string>[]) =>
  `${[header, ...rows.map((r) => header.map((h) => r[h] ?? ""))].map((l) => `${l.join("\t")}\t`).join("\n")}\n`;

function writeEbd() {
  const dir = join(src, "ebird-ebd", "fixture");
  mkdirSync(dir, { recursive: true });
  const list = (
    id: string,
    state: string,
    county: string,
    date: string,
    complete: string,
    group = "",
  ) => ({
    "SAMPLING EVENT IDENTIFIER": id,
    "STATE CODE": state,
    "COUNTY CODE": county,
    "OBSERVATION DATE": date,
    LATITUDE: "10.13",
    LONGITUDE: "76.7",
    "OBSERVER ID": "obsr1",
    "LOCALITY ID": "L1",
    "LOCALITY TYPE": "H",
    "PROTOCOL TYPE": "Traveling",
    "DURATION MINUTES": "60",
    "EFFORT DISTANCE KM": "1.5",
    "NUMBER OBSERVERS": "2",
    "ALL SPECIES REPORTED": complete,
    "GROUP IDENTIFIER": group,
    "TIME OBSERVATIONS STARTED": "07:00:00",
  });
  writeFileSync(
    join(dir, "ebd_IN_relOct-2026_sampling.txt"),
    tsv(SAMPLING_HEADER, [
      list("S1", "IN-KL", "IN-KL-ER", "2024-01-10", "1", "G1"),
      list("S2", "IN-KL", "IN-KL-ER", "2024-01-10", "1", "G1"), // shared copy of S1
      list("S3", "IN-KL", "IN-KL-XX", "2024-12-31", "0"), // unknown district -> state
      list("S4", "XX-YY", "", "2024-01-10", "1"), // unknown state -> skipped
    ]),
  );
  const obs = (
    list: string,
    category: string,
    sci: string,
    count: string,
    approved = "1",
    exotic = "",
  ) => ({
    "SAMPLING EVENT IDENTIFIER": list,
    CATEGORY: category,
    "SCIENTIFIC NAME": sci,
    "OBSERVATION COUNT": count,
    APPROVED: approved,
    "EXOTIC CODE": exotic,
  });
  writeFileSync(
    join(dir, "ebd_IN_relOct-2026.txt"),
    tsv(OBS_HEADER, [
      obs("S1", "species", "Fixtura synthetica1", "3"),
      obs("S1", "issf", "Fixtura synthetica1", "X"), // subspecies record: rolls up, count unknown
      obs("S1", "species", "Fixtura synthetica2", "2"),
      obs("S2", "species", "Fixtura synthetica2", "2", "0"), // not approved
      obs("S3", "spuh", "Fixtura sp.", "1"),
      obs("S3", "species", "Escapus cagebirdus", "1", "1", "X"), // not on the checklist
      obs("S9", "species", "Fixtura synthetica3", "1"), // checklist not in the sampling file
    ]),
  );
  addRelease({
    release_id: "ebird-ebd-fixture",
    source_id: "ebird-ebd",
    version: "fixture",
    published: null,
    status: "final",
    format: "ebd",
    file: "ebird-ebd/fixture",
    sha256: null,
  });
}

describe("eBird Basic Dataset", () => {
  test("loads checklists and species, rolls up subspecies, keeps unmatched names for review", async () => {
    writeEbd();
    await load(p, "ebird-ebd", "ebird-ebd-fixture", quiet);
    const lists = await query(
      "derived",
      "SELECT list_id, group_id, scope_code, week48, cell25, complete, duration_min FROM ebd_checklist ORDER BY 1",
    );
    expect(lists).toEqual([
      {
        list_id: "S1",
        group_id: "G1",
        scope_code: "IN-KL",
        week48: 2,
        cell25: cell25(10.13, 76.7),
        complete: true,
        duration_min: 60,
      },
      {
        list_id: "S2",
        group_id: "G1",
        scope_code: "IN-KL",
        week48: 2,
        cell25: cell25(10.13, 76.7),
        complete: true,
        duration_min: 60,
      },
      {
        list_id: "S3",
        group_id: null,
        scope_code: "IN-KL",
        week48: 48,
        cell25: cell25(10.13, 76.7),
        complete: false,
        duration_min: 60,
      },
    ]);
    const obs = await query(
      "derived",
      "SELECT list_id, taxon_id, how_many, approved FROM ebd_observation ORDER BY 1, 2",
    );
    expect(obs).toEqual([
      { list_id: "S1", taxon_id: "pv00001", how_many: null, approved: true },
      { list_id: "S1", taxon_id: "pv00002", how_many: 2, approved: true },
      { list_id: "S2", taxon_id: "pv00002", how_many: 2, approved: false },
    ]);
    const unmatched = await query(
      "derived",
      "SELECT sci_name, category, n_rows FROM ebd_unmatched ORDER BY 1",
    );
    expect(unmatched).toEqual([
      { sci_name: "Escapus cagebirdus", category: "species", n_rows: "1" },
      { sci_name: "Fixtura sp.", category: "spuh", n_rows: "1" },
    ]);
    expect(errorsOf(await allChecks(p))).toEqual([]);
  });

  test("reloading a release replaces its rows", async () => {
    writeEbd();
    await load(p, "ebird-ebd", "ebird-ebd-fixture", quiet);
    await load(p, "ebird-ebd", "ebird-ebd-fixture", quiet);
    expect(await one("derived", "SELECT count(*) FROM ebd_checklist")).toBe("3");
  });
});
