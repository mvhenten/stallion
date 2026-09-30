import type { Sticky } from "@stallion/schema";
import { expect, test } from "vitest";
import {
  DARK_INK,
  LIGHT_INK,
  newSticky,
  paintSticky,
  readableInk,
  STICKY_SHADOW_BLUR_PX,
  STICKY_SHADOW_COLOUR,
  STICKY_SHADOW_OFFSET_X_PX,
  STICKY_SHADOW_OFFSET_Y_PX,
  stickyMetrics,
} from "./sticky";

const note: Sticky = {
  type: "Sticky",
  objectId: "000000000aaaaaaaaaaaa",
  nativeZoom: 0,
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
  rgb: DARK_INK,
  background: 0xfff3a0,
  width: 18,
  text: "",
  font: "Sans",
  bold: false,
  italic: false,
  fit: "Fixed",
};

type Shadow = { colour: string; blur: number; offsetX: number; offsetY: number };
type ShadowLog = { shadows: Shadow[]; fills: number };

const fakeCtx = (
  width: number,
  height: number,
): { ctx: CanvasRenderingContext2D; log: ShadowLog } => {
  const log: ShadowLog = { shadows: [], fills: 0 };
  const ctx = {
    fillStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    canvas: { width, height },
    getTransform: () => ({ a: 1, d: 1 }),
    fillRect: () => {
      log.shadows.push({
        colour: ctx.shadowColor,
        blur: ctx.shadowBlur,
        offsetX: ctx.shadowOffsetX,
        offsetY: ctx.shadowOffsetY,
      });
      log.fills++;
    },
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
};

const rect = { x: 0, y: 0, width: 200, height: 200 };
const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };

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

test("casts a strong drop shadow behind an ordinary note, then resets it", () => {
  const { ctx, log } = fakeCtx(2000, 2000);
  paintSticky(ctx, note, [], rect, 1, false, bounds, false);
  expect(log.fills).toBe(1);
  expect(log.shadows).toEqual([
    {
      colour: STICKY_SHADOW_COLOUR,
      blur: STICKY_SHADOW_BLUR_PX,
      offsetX: STICKY_SHADOW_OFFSET_X_PX,
      offsetY: STICKY_SHADOW_OFFSET_Y_PX,
    },
  ]);
  expect(STICKY_SHADOW_COLOUR).toBe("rgba(0, 0, 0, 0.35)");
  expect(STICKY_SHADOW_BLUR_PX).toBe(10);
  expect(STICKY_SHADOW_OFFSET_X_PX).toBe(0);
  expect(STICKY_SHADOW_OFFSET_Y_PX).toBe(3);
  expect(ctx.shadowBlur).toBe(0);
});

test("skips the shadow for a note the caller flags oversized, and for one that would exceed the canvas", () => {
  const flagged = fakeCtx(2000, 2000);
  paintSticky(flagged.ctx, note, [], rect, 1, false, bounds, true);
  expect(flagged.log.shadows).toEqual([{ colour: "", blur: 0, offsetX: 0, offsetY: 0 }]);

  const tinyCanvas = fakeCtx(10, 10);
  paintSticky(tinyCanvas.ctx, note, [], rect, 1, false, bounds, false);
  expect(tinyCanvas.log.shadows).toEqual([{ colour: "", blur: 0, offsetX: 0, offsetY: 0 }]);
});
