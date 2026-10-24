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

test("the compact galaxy folds only the upper branch and keeps its body intact", () => {
  expect(galaxyPoint(0, 0, true)).toMatchObject({ x: 227, y: 174 });
  expect(galaxyPoint(1, 0, true)).toMatchObject({ x: 213, y: 190 });
  for (const path of [0, 1]) {
    const original = galaxyPoint(path, 1);
    expect(galaxyPoint(path, 1, true)).toMatchObject({
      x: original.x,
      y: original.y,
    });
  }
  for (const path of [2, 3, 4]) {
    for (let step = 0; step <= 100; step++) {
      expect(galaxyPoint(path, step / 100, true)).toEqual(
        galaxyPoint(path, step / 100),
      );
    }
  }
});

test("the folded branch makes a compact outline without scaling either axis", () => {
  const points = Array.from({ length: 5 }, (_, path) =>
    Array.from({ length: 101 }, (_, step) =>
      galaxyPoint(path, step / 100, true),
    ),
  ).flat();
  const horizontal =
    Math.max(...points.map((point) => point.x)) -
    Math.min(...points.map((point) => point.x));
  const vertical =
    Math.max(...points.map((point) => point.y)) -
    Math.min(...points.map((point) => point.y));
  expect(horizontal / vertical).toBeGreaterThan(0.9);
  expect(horizontal / vertical).toBeLessThan(1.1);
});

test("the folded upper filaments follow rounded arcs rather than a flat crest", () => {
  const center = { x: 115, y: 210 };
  const upperBranchLimit = 160;
  const sampleCount = 1000;
  const maximumRadialVariation = 0.1;
  for (const path of [0, 1]) {
    const radii = Array.from({ length: sampleCount + 1 }, (_, step) =>
      galaxyPoint(path, step / sampleCount, true),
    )
      .filter((point) => point.y < upperBranchLimit)
      .map((point) => Math.hypot(point.x - center.x, point.y - center.y));
    const mean =
      radii.reduce((total, radius) => total + radius, 0) / radii.length;
    expect((Math.max(...radii) - Math.min(...radii)) / mean).toBeLessThan(
      maximumRadialVariation,
    );
  }
});
