import { expect, test } from "vitest";
import { hitsFrame } from "./eraser";
import { scaleText, startText, textInkBox, textLines, textWrap, withTextContent } from "./text";
import type { Measure } from "./wrap";

const halfEm =
  (px: number): Measure =>
  (text) =>
    text.length * px * 0.5;

test("a narrower wrap width re-wraps the text and fits the box to the lines", () => {
  const placed = startText(0xe5484d, 1, { x: 0, y: 0 }, halfEm);
  if (placed?.object.type !== "Text") throw new Error("no text placed");
  const typed = withTextContent(placed.tile, placed.object, "buy milk and eggs today", halfEm);
  if (typed?.object.type !== "Text") throw new Error("no text typed");
  expect(textWrap(typed.tile, typed.object)).toBeCloseTo(320, 6);
  expect(textLines(typed.tile, typed.object, halfEm)).toEqual(["buy milk and eggs today"]);

  const anchor = { x: typed.object.bbox.minX, y: typed.object.bbox.minY };
  const narrowed = scaleText(typed.object, { anchor, sx: 0.5, sy: 1 }, halfEm);
  if (narrowed?.object.type !== "Text") throw new Error("no text after the resize");
  const { tile, object } = narrowed;
  expect(textWrap(tile, object)).toBeCloseTo(160, 6);
  expect(object.width).toBe(typed.object.width);
  expect(textLines(tile, object, halfEm)).toEqual(["buy milk and", "eggs today"]);
  expect(object.bbox.maxY - object.bbox.minY).toBeCloseTo(2 * 24 * 1.3, 6);
});

test("a short word hits only on its rendered line, not across the wrap width", () => {
  const placed = startText(0xe5484d, 1, { x: 0, y: 0 }, halfEm);
  if (placed?.object.type !== "Text") throw new Error("no text placed");
  const typed = withTextContent(placed.tile, placed.object, "hello", halfEm);
  if (typed?.object.type !== "Text") throw new Error("no text typed");
  const { object } = typed;
  const ink = textInkBox(object, textLines(typed.tile, object, halfEm), halfEm);
  expect(object.bbox.maxX - object.bbox.minX).toBeCloseTo(320, 6);
  expect(ink.maxX - ink.minX).toBeCloseTo(60, 6);
  expect(ink.maxY - ink.minY).toBeCloseTo(object.bbox.maxY - object.bbox.minY, 6);
  const middle = (object.bbox.minY + object.bbox.maxY) / 2;
  expect(hitsFrame({ bbox: ink }, { x: object.bbox.minX + 30, y: middle }, 1)).toBe(true);
  expect(hitsFrame({ bbox: ink }, { x: object.bbox.minX + 200, y: middle }, 1)).toBe(false);
});
