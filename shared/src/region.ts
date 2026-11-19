/**
 * eBird region codes, used as-is so no translation is needed:
 * `IN` (country), `IN-KL` (state), `IN-KL-ER` (district).
 */
export type RegionCode = string;

export type RegionKind = "country" | "state" | "district";

export function regionKind(code: RegionCode): RegionKind {
  const parts = code.split("-").length;
  if (parts === 1) return "country";
  if (parts === 2) return "state";
  return "district";
}
