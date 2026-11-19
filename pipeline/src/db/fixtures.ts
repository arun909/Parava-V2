/**
 * Tiny synthetic source files for tests, built at test time as one CSV per sheet.
 * Column names are the real ones; every species and value is made up.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENDEMIC_REGION_COLUMNS } from "./load/india-checklist.ts";
import type { Manifest } from "./manifest.ts";
import type { Paths } from "./paths.ts";

type Rec = Record<string, string>;

function writeCsv(file: string, headers: string[], rows: Rec[]): void {
  const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = [
    headers.map(q).join(","),
    ...rows.map((r) => headers.map((h) => q(r[h] ?? "")).join(",")),
  ];
  writeFileSync(file, `${lines.join("\n")}\n`);
}

/** Ten synthetic species. Two share an old v7.1 name, like Bean Goose in the real file. */
export const SPECIES = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    sl: String(n),
    order: n <= 5 ? "Anseriformes" : "Passeriformes",
    family: n <= 5 ? "Anatidae" : "Pittidae",
    familyEn: n <= 5 ? "Ducks, Geese, and Waterfowl" : "Pittas",
    sci: `Fixtura synthetica${n}`,
    en: `Synthetic Bird ${n}`,
    oldSci: n === 2 || n === 3 ? "Fixtura synthetica2" : `Fixtura synthetica${n}`,
  };
});

const CHECKLIST_HEADERS = [
  "Sl No",
  "Order",
  "Family",
  "Species",
  "English Name",
  "Scientific Name",
  "Authority",
  "Alternative Names",
  "Vagrant",
  "Historical",
  "IUCN RedList",
  "WPA Schedule",
  "SOIB",
  "CITES Appendix",
  "CMS Appendix",
  "Endemic (India)",
  ...ENDEMIC_REGION_COLUMNS,
];

const APPENDIX_HEADERS = [
  "Sl No",
  "Order",
  "Family",
  "Species",
  "English Name",
  "Scientific Name",
  "Authority",
];

const INDIA_HEADERS = [
  "English Name",
  "Scientific Name",
  "SoIB 2023 Priority Status",
  "SoIB 2023 Long-term Trend Status",
  "SoIB 2023 Current Annual Trend Status",
  "SoIB 2023 Distribution Range Size Status",
  "eBird.English.Name.2025",
  "eBird.Scientific.Name.2025",
  "BLI.Common.Name.2025",
  "BLI.Scientific.Name.2025",
  "India.Checklist.Common.Name.2025",
  "India.Checklist.Scientific.Name.2025",
  "Order",
  "Family",
  "Breeding Activity Period",
  "Non-breeding Activity Period",
  "Diet Guild",
  "Endemicity",
  "Endemic to India",
  "Endemic to Subcontinent",
  "Endemic to Himalaya",
  "Habitat Specialization",
  "Migratory Status within India",
  "Restricted to Islands",
  "IUCN Category",
  "WPA Schedule",
  "CITES Appendix",
  "CMS Appendix",
  "1% Population Threshold",
  "Generation Length",
  "Number of Subspecies",
  "Percent of Global Range",
  "India Checklist Sort Order",
  "Avilist English Name",
  "Avilist Scientific Name",
  "Avibase ID",
  "Selected for NRL",
  "Selected for SoIB",
  "Selected for Long-term Trend",
  "Selected for Current Annual Trend",
  "Long-term Trend LCI",
  "Long-term Trend Mean",
  "Long-term Trend UCI",
  "Current Annual Trend LCI",
  "Current Annual Trend Mean",
  "Current Annual Trend UCI",
  "Distribution Range Size LCI",
  "Distribution Range Size Mean",
  "Distribution Range Size UCI",
  "Number of Grids",
  "Range Coverage (Pre-2000)",
  "Range Coverage (Current)",
  "Range Coverage (2025)",
  "Grid Coverage Mean",
  "Grid Coverage CI",
  "Projected % Decline in 3 Generations",
  "Regional Red List Category",
  "SoIB 2020 Concern Status",
  "SoIB 2020 Long-term Trend Status",
  "SoIB 2020 Current Annual Trend Status",
  "SoIB 2020 Distribution Range Size Status",
];

/** Columns state sheets don't carry (national only), plus a sheet-specific gap. */
const NATIONAL_ONLY = new Set(
  INDIA_HEADERS.filter(
    (h) =>
      h.startsWith("SoIB 2020") ||
      [
        "Projected % Decline in 3 Generations",
        "Regional Red List Category",
        "SoIB 2023 Distribution Range Size Status",
      ].includes(h),
  ),
);

/** Every SoIB sheet name the loader expects, from the scope_alias seed. */
export const SOIB_SHEETS = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli",
  "Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Woodland",
  "Cropland",
  "ONEs",
  "PAs",
];

function indiaRow(s: (typeof SPECIES)[number], i: number): Rec {
  const selected = i < 7;
  return {
    "English Name": s.oldSci === "Fixtura synthetica2" ? "Synthetic Bird 2 (old)" : s.en,
    "Scientific Name": s.oldSci,
    "SoIB 2023 Priority Status": selected ? (["High", "Moderate", "Low"][i % 3] ?? "") : "",
    "SoIB 2023 Long-term Trend Status": selected ? "Rapid Decline" : "",
    "SoIB 2023 Current Annual Trend Status": selected ? "Stable" : "",
    "SoIB 2023 Distribution Range Size Status": selected ? "Restricted" : "",
    "eBird.English.Name.2025": s.en,
    "eBird.Scientific.Name.2025": s.sci,
    "BLI.Common.Name.2025": s.en,
    "BLI.Scientific.Name.2025": s.sci,
    "India.Checklist.Common.Name.2025": s.en,
    "India.Checklist.Scientific.Name.2025": s.sci,
    Order: s.order,
    Family: `${s.family} (${s.familyEn})`,
    "Breeding Activity Period": "Diurnal",
    "Non-breeding Activity Period": "24 hour",
    "Diet Guild": "Fruit & Nect",
    Endemicity: i === 0 ? "Western Ghats" : "Non-endemic",
    "Endemic to India": i === 0 ? "1" : "0",
    "Endemic to Subcontinent": "0",
    "Endemic to Himalaya": "0",
    "Habitat Specialization": "Forest & Plantation",
    "Migratory Status within India":
      i === 1
        ? "Resident & Altitudinal Migrant"
        : i === 2
          ? "Winter Migrant (Extirpated)"
          : "Resident",
    "Restricted to Islands": "0",
    "IUCN Category": "Least Concern",
    "WPA Schedule": "Schedule-II",
    "CITES Appendix": "",
    "CMS Appendix": i === 3 ? "Appendix II" : "",
    "1% Population Threshold": i < 5 ? "250" : "",
    "Generation Length": "4.5",
    "Number of Subspecies": "1",
    "Percent of Global Range": "0.25",
    "India Checklist Sort Order": s.sl,
    "Avilist English Name": s.en,
    "Avilist Scientific Name": s.sci,
    "Avibase ID": `AVIBASE-${s.sl}`,
    "Selected for NRL": i < 8 ? "1" : "",
    "Selected for SoIB": selected ? "1" : "0",
    "Selected for Long-term Trend": selected ? "1" : "0",
    "Selected for Current Annual Trend": selected ? "1" : "0",
    "Long-term Trend LCI": selected ? "-40" : "",
    "Long-term Trend Mean": selected ? "-30" : "",
    "Long-term Trend UCI": selected ? "-20" : "",
    "Current Annual Trend LCI": selected ? "-1" : "",
    "Current Annual Trend Mean": selected ? "0" : "",
    "Current Annual Trend UCI": selected ? "1" : "",
    "Distribution Range Size LCI": selected ? "1000" : "",
    "Distribution Range Size Mean": selected ? "1200" : "",
    "Distribution Range Size UCI": selected ? "1400" : "",
    "Number of Grids": "12",
    "Range Coverage (Pre-2000)": "10",
    "Range Coverage (Current)": "50",
    "Range Coverage (2025)": "40",
    "Grid Coverage Mean": "5",
    "Grid Coverage CI": "1",
    "Projected % Decline in 3 Generations": i === 0 ? "35" : "",
    "Regional Red List Category": i === 0 ? "Vulnerable" : "",
    "SoIB 2020 Concern Status": i < 6 ? "Moderate" : "",
    "SoIB 2020 Long-term Trend Status": i < 6 ? "Strong Decline" : "",
    "SoIB 2020 Current Annual Trend Status": i < 6 ? "Uncertain" : "",
    "SoIB 2020 Distribution Range Size Status": i < 6 ? "Restricted" : "",
  };
}

/** Write both fixture "workbooks" and a manifest; return paths pointing at them. */
export function writeFixtures(root: string, sqlDir: string): Paths {
  const dataDir = join(root, "data");
  const cl = join(dataDir, "sources", "india-checklist", "fixture-v10.1");
  const soib = join(dataDir, "sources", "soib", "fixture-soib");
  mkdirSync(cl, { recursive: true });
  mkdirSync(soib, { recursive: true });

  writeCsv(
    join(cl, "India_Checklist_10_1.csv"),
    CHECKLIST_HEADERS,
    SPECIES.map((s, i) => ({
      "Sl No": s.sl,
      Order: s.order,
      Family: s.family,
      Species: `${s.en} ${s.sci}`,
      "English Name": s.en,
      "Scientific Name": s.sci,
      Authority: "(Fixture, 2026)",
      "Alternative Names": i === 0 ? "Old Name; [Other Name]" : "",
      Vagrant: i === 9 ? "X" : "",
      Historical: i === 8 ? "X" : "",
      "IUCN RedList": "Least Concern",
      "WPA Schedule": "Schedule-II",
      SOIB: "Low",
      "CITES Appendix": "",
      "CMS Appendix": i === 3 ? "Appendix II" : "",
      "Endemic (India)": i === 0 ? "X" : "",
      "Endemic (Western Ghats)": i === 0 ? "X" : "",
    })),
  );
  writeCsv(join(cl, "README.csv"), ["FOR", "README"], [{ FOR: "Fixture", README: "Synthetic" }]);
  writeCsv(
    join(cl, "Additional Bibilography.csv"),
    ["Sl No", "Version", "Reference"],
    [{ "Sl No": "1", Version: "1.1", Reference: "Synthetic reference" }],
  );
  for (const n of [1, 2]) {
    writeCsv(join(cl, `Appendix ${n}.csv`), APPENDIX_HEADERS, [
      {
        "Sl No": "1",
        Order: "Anseriformes",
        Family: "Anatidae",
        Species: "Escaped Fixture",
        "English Name": `Appendix ${n} Bird`,
        "Scientific Name": `Appendixa fixtura${n}`,
        Authority: "(X, 1900)",
      },
    ]);
  }

  const india = SPECIES.map(indiaRow);
  writeCsv(
    join(soib, "README.csv"),
    ["Field Name", "Class", "Exclusive to National"],
    [{ "Field Name": "English Name", Class: "character", "Exclusive to National": "0" }],
  );
  writeCsv(join(soib, "India.csv"), INDIA_HEADERS, india);
  const stateHeaders = INDIA_HEADERS.filter((h) => !NATIONAL_ONLY.has(h));
  for (const sheet of SOIB_SHEETS) {
    const isHabitat = ["Woodland", "Cropland", "ONEs", "PAs"].includes(sheet);
    // Kerala has every species; Andhra Pradesh lacks long-term trend columns; others have two
    let headers = isHabitat ? stateHeaders : [...stateHeaders, "State Where Species Key"];
    if (sheet === "Andhra Pradesh")
      headers = headers.filter((h) => !h.startsWith("Long-term Trend "));
    const rows = (sheet === "Kerala" ? india : india.slice(0, 2)).map((r, i) => ({
      ...r,
      "State Where Species Key": i === 0 ? "1" : "0",
    }));
    writeCsv(join(soib, `${sheet}.csv`), headers, rows);
  }

  const manifest: Manifest = {
    releases: [
      {
        release_id: "india-checklist-v10.1",
        source_id: "india-checklist",
        version: "fixture",
        published: "2026-05-15",
        status: "final",
        format: "csv-dir",
        file: "india-checklist/fixture-v10.1",
      },
      {
        release_id: "soib-2026-v0",
        source_id: "soib",
        version: "fixture",
        published: null,
        status: "draft",
        format: "csv-dir",
        file: "soib/fixture-soib",
      },
      {
        release_id: "soib-2020",
        source_id: "soib",
        version: "2020",
        published: "2020-02-17",
        status: "superseded",
        format: "columns-of",
        of: "soib-2026-v0",
      },
    ],
  };
  const manifestFile = join(root, "sources.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return { dataDir, manifestFile, sqlDir, reportsDir: join(root, "reports") };
}

/** Rewrite one cell of a fixture sheet, to make a bad file. */
export function corrupt(
  p: Paths,
  sheet: string,
  header: string,
  rowIndex: number,
  value: string,
): void {
  const dir = join(p.dataDir, "sources", "soib", "fixture-soib");
  const file = join(dir, `${sheet}.csv`);
  const text = readFileSync(file, "utf8");
  const [head = "", ...lines] = text.trimEnd().split("\n");
  const cols = head.split('","').map((c) => c.replace(/^"|"$/g, ""));
  const at = cols.indexOf(header);
  if (at < 0) throw new Error(`no column ${header} in ${sheet}`);
  const cells = (lines[rowIndex] ?? "").split('","').map((c) => c.replace(/^"|"$/g, ""));
  cells[at] = value;
  lines[rowIndex] = cells.map((c) => `"${c}"`).join(",");
  writeFileSync(file, `${[head, ...lines].join("\n")}\n`);
}
