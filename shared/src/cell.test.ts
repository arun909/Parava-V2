import { describe, expect, test } from "bun:test";
import { cell25 } from "./cell.ts";

describe("cell25", () => {
  test("keys a point by its 0.25° row and column", () => {
    // Thattekad, Kerala
    expect(cell25(10.13, 76.7)).toBe("g25_400_1026");
  });

  test("puts a point on a cell edge in the cell to its north-east", () => {
    expect(cell25(10, 76.75)).toBe("g25_400_1027");
    expect(cell25(9.9999, 76.7499)).toBe("g25_399_1026");
  });

  test("never produces negative keys", () => {
    expect(cell25(-90, -180)).toBe("g25_0_0");
  });
});
