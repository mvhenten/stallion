import type { Stroke } from "@stallion/schema";
import { describe, expect, test } from "vitest";
import { hitsStroke } from "./eraser";

const tile = { level: 0, tx: 0, ty: 0 };

const stroke: Stroke = {
  type: "Stroke",
  objectId: "000000000aaaaaaaaaaaa",
  nativeZoom: 0,
  bbox: { minX: 10, minY: 10, maxX: 110, maxY: 10 },
  colour: 0,
  rgb: 0x1f2328,
  size: "Small",
  style: "Pen",
  points: [
    [10, 10, 0.5],
    [110, 10, 0.5],
  ],
};

describe("hitsStroke", () => {
  test("at zoom 1 the tolerance is about 8 world units", () => {
    expect(hitsStroke(tile, stroke, { x: 60, y: 18 }, 1)).toBe(true);
    expect(hitsStroke(tile, stroke, { x: 60, y: 22 }, 1)).toBe(false);
  });

  test("at zoom 4 the same screen tolerance covers a quarter of the world distance", () => {
    expect(hitsStroke(tile, stroke, { x: 60, y: 12 }, 4)).toBe(true);
    expect(hitsStroke(tile, stroke, { x: 60, y: 18 }, 4)).toBe(false);
  });
});
