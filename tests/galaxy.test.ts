import { expect, test } from "bun:test";
import { galaxyPoint } from "../src/galaxy";

test("the asymmetric galaxy keeps every sampled trajectory inside its authored frame", () => {
  const starts = new Set<string>();
  for (let path = 0; path < 5; path++) {
    const start = galaxyPoint(path, 0);
    starts.add(`${start.x},${start.y}`);
    for (let step = 0; step <= 100; step++) {
      const point = galaxyPoint(path, step / 100);
      expect(Number.isFinite(point.x + point.y + point.dx + point.dy)).toBe(
        true,
      );
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(231);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(325);
    }
  }
  expect(starts.size).toBe(5);
});

test("galaxy sampling clamps endpoints and rejects invalid paths", () => {
  expect(galaxyPoint(0, -1)).toEqual(galaxyPoint(0, 0));
  expect(galaxyPoint(0, 2)).toEqual(galaxyPoint(0, 1));
  expect(() => galaxyPoint(5, 0)).toThrow("Invalid galaxy path");
  expect(() => galaxyPoint(0, Number.NaN)).toThrow("Invalid galaxy path");
});
