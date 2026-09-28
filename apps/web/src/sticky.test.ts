import { expect, test } from "vitest";
import { DARK_INK, LIGHT_INK, newSticky, readableInk, stickyMetrics } from "./sticky";

test("writes dark ink on a light note and light ink on a dark one", () => {
  expect(readableInk(0xfff3a0)).toBe(DARK_INK);
  expect(readableInk(0x1f2328)).toBe(LIGHT_INK);
});

test("a new note is the default size on screen with its font inside the width bounds", () => {
  for (const zoom of [0.3, 1, 2.7]) {
    const sticky = newSticky(0xfff3a0, zoom, { x: 0, y: 0 });
    expect((sticky.bbox.maxX - sticky.bbox.minX) * zoom).toBeCloseTo(200, 9);
    expect(stickyMetrics(sticky).font * zoom).toBeCloseTo(18, 9);
  }
});
