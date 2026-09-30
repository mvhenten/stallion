import { expect, test } from "vitest";
import { fitFont, fitsFrame } from "./fit";
import { autoFitSticky, newSticky, scaleSticky, stickyLines, stickyMetrics } from "./sticky";
import { scaleText, startText, textLines, withTextContent } from "./text";
import { LINE_HEIGHT, type Measure } from "./wrap";

const halfEm =
  (px: number): Measure =>
  (text) =>
    text.length * px * 0.5;

const range = { min: 0.5, max: 200 };

test("the fitted font is the largest at which the wrapped text still fits the frame", () => {
  const frame = { width: 200, height: 200, padEm: 0.6 };
  const text = "buy milk and eggs today and bread";
  const font = fitFont(text, frame, range, halfEm);
  expect(fitsFrame(text, font, frame, halfEm)).toBe(true);
  expect(fitsFrame(text, font * 1.01, frame, halfEm)).toBe(false);
});

test("text that cannot fit even at the smallest size keeps the smallest size", () => {
  const frame = { width: 10, height: 1, padEm: 0 };
  expect(fitFont("x".repeat(500), frame, range, halfEm)).toBe(range.min);
});

test("an auto sticky sizes its font to the note, shrinks with it, and keeps the text inside it", () => {
  const sticky = {
    ...newSticky(0xfff3a0, 1, { x: 100, y: 100 }),
    text: "hello there",
    fit: "Auto" as const,
  };
  const fitted = autoFitSticky(sticky, halfEm);
  const { font, pad, lineHeight } = stickyMetrics(fitted);
  const height = sticky.bbox.maxY - sticky.bbox.minY;
  expect(stickyLines(fitted, halfEm).length * lineHeight + pad * 2).toBeLessThanOrEqual(
    height + 1e-6,
  );
  expect(font).toBeGreaterThan(stickyMetrics(sticky).font);

  const anchor = { x: sticky.bbox.minX, y: sticky.bbox.minY };
  const halved = scaleSticky(fitted, { anchor, sx: 0.5, sy: 0.5 }, halfEm);
  if (halved?.object.type !== "Sticky") throw new Error("no sticky after the resize");
  expect(stickyMetrics(halved.object).font).toBeCloseTo(font / 2, 1);
  expect(halved.object.bbox.maxY - halved.object.bbox.minY).toBeCloseTo(height / 2, 6);
});

test("an auto text fills its wrap width on one line and wraps when the box is made taller", () => {
  const placed = startText(0xe5484d, 1, { x: 0, y: 0 }, halfEm);
  if (placed?.object.type !== "Text") throw new Error("no text placed");
  const typed = withTextContent(
    placed.tile,
    { ...placed.object, fit: "Auto" },
    "twelve chars",
    halfEm,
  );
  if (typed?.object.type !== "Text") throw new Error("no text typed");
  const { object } = typed;
  const oneLine = object.bbox.maxY - object.bbox.minY;
  expect(textLines(typed.tile, object, halfEm)).toEqual(["twelve chars"]);
  const font = oneLine / LINE_HEIGHT;
  expect(12 * font * 0.5).toBeCloseTo(320, 6);

  const anchor = { x: object.bbox.minX, y: object.bbox.minY };
  const taller = scaleText(object, { anchor, sx: 1, sy: 3 }, halfEm);
  if (taller?.object.type !== "Text") throw new Error("no text after the resize");
  expect(textLines(taller.tile, taller.object, halfEm)).toEqual(["twelve", "chars"]);
  expect(taller.object.bbox.maxY - taller.object.bbox.minY).toBeCloseTo(oneLine * 3, 6);
  expect(taller.object.width).toBeGreaterThan(object.width);
});
