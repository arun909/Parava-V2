/**
 * Placeholder data so place routes build before the pipeline exports exist.
 * Replace with exported scope data in Phase 2.
 */
import type { RegionCode } from "@parava/shared";

export interface PlaceStub {
  code: RegionCode;
  name: string;
}

export const samplePlaces: PlaceStub[] = [
  { code: "IN-KL", name: "Kerala" },
  { code: "IN-KA", name: "Karnataka" },
  { code: "IN-GJ", name: "Gujarat" },
];
