import { describe, expect, test } from "vitest";
import { isVisible } from "./culling";

const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe("culling", () => {
  test("draws an object inside the view", () => {
    expect(isVisible({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, view, 1)).toBe(true);
  });

  test("draws an object that covers the whole view", () => {
    expect(isVisible({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, view, 1)).toBe(true);
  });

  test("culls an object outside the view", () => {
    expect(isVisible({ minX: 101, minY: 10, maxX: 120, maxY: 20 }, view, 1)).toBe(false);
  });

  test("culls an object below one pixel and draws it once zoomed in", () => {
    const speck = { minX: 50, minY: 50, maxX: 50.4, maxY: 50.4 };
    expect(isVisible(speck, view, 1)).toBe(false);
    expect(isVisible(speck, view, 4)).toBe(true);
  });
});
