/**
 * Species records as exported from the base database for the site.
 * Category fields hold lookup codes; resolve labels with {@link Lookups}.
 */

/** A lookup code, e.g. `within-india-migrant`. */
export type Code = string;

/** scheme → code → label, from the base `lookup` table. */
export type Lookups = Record<string, Record<Code, string>>;

/** One row of the species index: enough to list, filter and link. */
export interface SpeciesSummary {
  id: string; // pv00625
  slug: string; // eBird code, used in URLs
  sortOrder: number;
  enName: string;
  sciName: string;
  familySci: string;
  familyEn: string | null;
  migratoryStatus: Code | null;
  iucn: Code | null;
  priority: Code | null;
  endemicIndia: boolean | null;
}

export interface SpeciesName {
  authority: string;
  sciName: string;
  enName: string | null;
}

export interface Trend {
  status: Code | null;
  meanPct: number | null;
  lciPct: number | null;
  uciPct: number | null;
}

/** One SoIB assessment for one scope (India, a state, or a habitat). */
export interface Assessment {
  scope: string;
  scopeName: string | null;
  priority: Code | null;
  longTerm: Trend;
  current: Trend;
  rangeStatus: Code | null;
  rangeKm2: number | null;
  nGrids: number | null;
}

export interface SpeciesDetail extends SpeciesSummary {
  orderSci: string;
  authority: string | null;
  xrefs: Record<string, string>; // system → external id
  names: SpeciesName[];
  altNames: string | null;
  status: {
    migratoryParts: Code[];
    endemicity: Code | null;
    endemicRegions: Code[];
    vagrant: boolean | null;
    historical: boolean | null;
  };
  legal: { wpaSchedule: Code | null; cites: Code | null; cms: Code | null };
  ecology: {
    diet: Code | null;
    habitat: Code | null;
    activityBreeding: Code | null;
    activityNonbreeding: Code | null;
    trophicLevel: Code | null;
    lifestyle: Code | null;
  };
  morphology: {
    massG: number | null;
    lengthCm: number | null;
    wingspanCm: number | null;
    wingMm: number | null;
    handWingIndex: number | null;
  };
  population: {
    generationYears: number | null;
    shareGlobalRange: number | null;
    pct1Threshold: number | null;
    nSubspeciesIndia: number | null;
  };
  assessments: Assessment[];
  /** Releases the record was built from. */
  releases: string[];
}

/** Lookup scheme for each category field, so the UI can label codes. */
export const LOOKUP_SCHEME = {
  migratoryStatus: "migratory",
  migratoryPart: "migratory-part",
  endemicity: "endemicity",
  endemicRegion: "endemic-region",
  iucn: "iucn",
  wpaSchedule: "wpa",
  cites: "cites",
  cms: "cms",
  diet: "diet",
  habitat: "habitat",
  activity: "activity",
  trophicLevel: "avonet-trophic-level",
  lifestyle: "avonet-lifestyle",
  priority: "soib-priority-2023",
  trend: "soib-trend-2023",
  range: "soib-range-2023",
} as const;
