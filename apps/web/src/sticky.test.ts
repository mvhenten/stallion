import { expect, test } from "vitest";
import { DARK_INK, LIGHT_INK, newSticky, readableInk, stickyMetrics, wrapText } from "./sticky";

const chars = (text: string): number => text.length;

test("keeps a line that fits whole", () => {
  expect(wrapText("buy milk", 10, chars)).toEqual(["buy milk"]);
});

test("breaks between words at the width", () => {
  expect(wrapText("buy milk and eggs today", 10, chars)).toEqual(["buy milk", "and eggs", "today"]);
});

test("keeps typed line breaks and blank lines", () => {
  expect(wrapText("one\n\ntwo", 10, chars)).toEqual(["one", "", "two"]);
  expect(wrapText("", 10, chars)).toEqual([""]);
});

test("breaks a word longer than the width by characters", () => {
  expect(wrapText("ab supercalifragilistic cd", 8, chars)).toEqual([
    "ab",
    "supercal",
    "ifragili",
    "stic cd",
  ]);
});

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
