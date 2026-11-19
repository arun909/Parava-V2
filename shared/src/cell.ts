/**
 * Near-me grid: 0.25° cells (about 28 km), keyed `g25_<row>_<col>`.
 * row = floor((lat + 90) / 0.25), col = floor((lon + 180) / 0.25), so keys are never negative.
 * A phone can work out its own cell with this one line of maths.
 * The pipeline computes the same key in SQL (pipeline/src/db/load/common.ts, cell25Sql).
 */
export type Cell25 = string;

export function cell25(lat: number, lon: number): Cell25 {
  const row = Math.floor((lat + 90) / 0.25);
  const col = Math.floor((lon + 180) / 0.25);
  return `g25_${row}_${col}`;
}
