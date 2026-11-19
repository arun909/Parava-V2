import { describe, expect, test } from "bun:test";
import { week48 } from "./week.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("week48", () => {
  test("splits a month into days 1–7, 8–14, 15–21, 22–end", () => {
    expect(week48(d("2026-01-01"))).toBe(1);
    expect(week48(d("2026-01-07"))).toBe(1);
    expect(week48(d("2026-01-08"))).toBe(2);
    expect(week48(d("2026-01-21"))).toBe(3);
    expect(week48(d("2026-01-22"))).toBe(4);
    expect(week48(d("2026-01-31"))).toBe(4);
  });

  test("runs from 1 in January to 48 at the end of December", () => {
    expect(week48(d("2026-02-01"))).toBe(5);
    expect(week48(d("2026-12-31"))).toBe(48);
  });
});
