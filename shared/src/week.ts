/**
 * Birding week, 1–48: four per month (days 1–7, 8–14, 15–21, 22–end),
 * the same scheme as eBird's bar charts.
 */
export type Week48 = number;

export function week48(date: Date): Week48 {
  const month = date.getUTCMonth(); // 0–11
  const day = date.getUTCDate(); // 1–31
  const quarter = Math.min(Math.floor((day - 1) / 7), 3); // 0–3
  return month * 4 + quarter + 1;
}
