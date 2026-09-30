import { expect, test } from "vitest";
import {
  type Candidate,
  isLocatingMode,
  LOCATOR_MAX,
  LOCATOR_SEARCH_PX,
  locate,
  RIPPLE_MAX_PX,
  RIPPLE_PERIOD_MS,
  RIPPLE_RINGS,
  rings,
  screenRadius,
} from "./locator";
import type { ToolMode } from "./surface";

const dot = (x: number, y: number, radius = 1): Candidate => ({ x, y, radius, style: "#ff0000" });

test("the ripple runs in Select, Pan and Eraser, but not while drawing", () => {
  const modes: ToolMode[] = ["Pencil", "Shape", "Sticky", "Text", "Pan", "Eraser", "Select"];
  expect(modes.filter(isLocatingMode)).toEqual(["Pan", "Eraser", "Select"]);
});

test("a sub-pixel object counts as a marker-sized radius", () => {
  expect(screenRadius({ minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }, 1)).toBe(1);
  expect(screenRadius({ minX: 0, minY: 0, maxX: 40, maxY: 10 }, 0.25)).toBe(5);
});

test("only small objects within the search radius qualify", () => {
  const found = locate(
    [dot(80, 0), dot(LOCATOR_SEARCH_PX + 1, 0), dot(0, 50, 10), dot(0, 60, 9.9)],
    { x: 0, y: 0 },
  );
  expect(found.map(({ x, y }) => [x, y])).toEqual([
    [0, 60],
    [80, 0],
  ]);
});

test("the nearest pulses strongest and at most five pulse", () => {
  const found = locate(
    Array.from({ length: 8 }, (_, index) => dot(20 + index * 10, 0)),
    { x: 0, y: 0 },
  );
  expect(found).toHaveLength(LOCATOR_MAX);
  expect(found[0]?.strength).toBe(1);
  const strengths = found.map(({ strength }) => strength);
  expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
  expect(found[1]?.strength).toBeLessThan(1);
});

test("the pointer inside an object's hit radius silences the ripple", () => {
  expect(locate([dot(5, 0), dot(80, 0)], { x: 0, y: 0 })).toEqual([]);
});

test("rings expand, fade and loop within the size cap", () => {
  const [locator] = locate([dot(60, 0)], { x: 0, y: 0 });
  if (!locator) throw new Error("no locator");
  const early = rings(locator, 100);
  const later = rings(locator, 500);
  expect(early).toHaveLength(RIPPLE_RINGS);
  expect(later[0]?.radius).toBeGreaterThan(early[0]?.radius ?? 0);
  expect(later[0]?.alpha).toBeLessThan(early[0]?.alpha ?? 0);
  const looped = rings(locator, RIPPLE_PERIOD_MS + 100)[0];
  expect(looped?.radius).toBeCloseTo(early[0]?.radius ?? 0);
  expect(looped?.alpha).toBeCloseTo(early[0]?.alpha ?? 0);
  for (let t = 0; t < 3 * RIPPLE_PERIOD_MS; t += 37) {
    for (const ring of rings(locator, t)) {
      expect(ring.radius).toBeLessThanOrEqual(RIPPLE_MAX_PX);
      expect(ring.alpha).toBeGreaterThanOrEqual(0);
      expect(ring.alpha).toBeLessThanOrEqual(1);
    }
  }
});

test("later rings wait their turn before they appear", () => {
  const [locator] = locate([dot(60, 0)], { x: 0, y: 0 });
  if (!locator) throw new Error("no locator");
  expect(rings(locator, 0).map(({ alpha }) => alpha > 0)).toEqual([true, false, false]);
});
