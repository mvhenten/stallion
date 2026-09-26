import { expect, test } from "vitest";
import { levelOf, levelOptions, zoomForLevel } from "./level";

test("the level is 0 at the initial zoom, negative zoomed in, positive zoomed out", () => {
  expect(levelOf(1)).toBe(0);
  expect(levelOf(4)).toBe(-2);
  expect(levelOf(0.25)).toBe(2);
  expect(levelOf(zoomForLevel(-5))).toBe(-5);
});

test("the level list spans the content levels plus one beyond each side, deepest first", () => {
  const options = levelOptions(0, [-2, 1, 1]);
  expect(options.map((option) => option.level)).toEqual([-3, -2, -1, 0, 1, 2]);
  expect(options.filter((option) => option.hasContent).map((option) => option.level)).toEqual([
    -2, 1,
  ]);
  expect(options.filter((option) => option.current).map((option) => option.level)).toEqual([0]);
  expect(levelOptions(3, []).map((option) => option.level)).toEqual([2, 3, 4]);
});
