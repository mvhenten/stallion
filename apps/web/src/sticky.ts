import type { StoredObject } from "@stallion/client-store";
import { type BBox, nativeLevel, type Point, place } from "@stallion/geometry";
import { clampUtf8, MAX_WIDTH, MIN_WIDTH, rgbHex, type Sticky } from "@stallion/schema";
import { clipRect } from "./clip";
import { fitFont } from "./fit";
import { newObjectId, type Scale, scaleAbout, strokeWorldWidth } from "./stroke";
import { applyTextChange, type TextChange } from "./text-change";
import {
  clampFont,
  fontForScreen,
  LINE_HEIGHT,
  type MeasureAt,
  measureIn,
  paintLines,
  worldFont,
  wrapWorld,
} from "./wrap";

export const STICKY_PX = 200;

export const STICKY_FONT_PX = 18;

export const PAD_EM = 0.6;

export const DARK_INK = 0x1f2328;

export const LIGHT_INK = 0xfbfaf7;

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 0xff,
  (rgb >> 8) & 0xff,
  rgb & 0xff,
];

export const readableInk = (background: number): number => {
  const [r, g, b] = channels(background);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? DARK_INK : LIGHT_INK;
};

export type StickyMetrics = { font: number; pad: number; lineHeight: number; inner: number };

export const stickyMetrics = (
  sticky: Pick<Sticky, "width" | "nativeZoom" | "bbox">,
): StickyMetrics => {
  const font = worldFont(sticky);
  const pad = font * PAD_EM;
  return {
    font,
    pad,
    lineHeight: font * LINE_HEIGHT,
    inner: Math.max(0, sticky.bbox.maxX - sticky.bbox.minX - pad * 2),
  };
};

export const stickyLines = (sticky: Sticky, measureAt: MeasureAt): string[] => {
  const { font, inner } = stickyMetrics(sticky);
  return wrapWorld(sticky.text, inner, font, measureIn(measureAt, sticky));
};

export const autoFitSticky = (sticky: Sticky, measureAt: MeasureAt): Sticky => {
  if (sticky.fit !== "Auto" || sticky.text.trim() === "") return sticky;
  const unit = strokeWorldWidth(1, sticky.nativeZoom);
  const { bbox } = sticky;
  const font = fitFont(
    sticky.text,
    { width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY, padEm: PAD_EM },
    { min: MIN_WIDTH * unit, max: MAX_WIDTH * unit },
    measureIn(measureAt, sticky),
  );
  return { ...sticky, width: clampFont(font / unit) };
};

const fitHeight = (sticky: Sticky, measureAt: MeasureAt): Sticky => {
  const { pad, lineHeight } = stickyMetrics(sticky);
  const needed = pad * 2 + stickyLines(sticky, measureAt).length * lineHeight;
  const { bbox } = sticky;
  if (bbox.maxY - bbox.minY >= needed) return sticky;
  return { ...sticky, bbox: { ...bbox, maxY: bbox.minY + needed } };
};

const placeSticky = (sticky: Sticky): StoredObject | undefined => {
  const placed = place(sticky.bbox);
  return placed.ok ? { tile: placed.tile, object: sticky } : undefined;
};

export const newSticky = (background: number, zoom: number, centre: Point): Sticky => {
  const nativeZoom = nativeLevel(zoom);
  const half = STICKY_PX / zoom / 2;
  return {
    type: "Sticky",
    objectId: newObjectId(),
    nativeZoom,
    bbox: {
      minX: centre.x - half,
      minY: centre.y - half,
      maxX: centre.x + half,
      maxY: centre.y + half,
    },
    rgb: readableInk(background),
    background,
    width: fontForScreen(STICKY_FONT_PX, nativeZoom, zoom),
    text: "",
    font: "Sans",
    bold: false,
    italic: false,
    fit: "Fixed",
  };
};

export const startSticky = (
  background: number,
  zoom: number,
  centre: Point,
): StoredObject | undefined => placeSticky(newSticky(background, zoom, centre));

const layoutSticky = (sticky: Sticky, measureAt: MeasureAt): Sticky =>
  fitHeight(autoFitSticky(sticky, measureAt), measureAt);

export const withText = (
  sticky: Sticky,
  text: string,
  measureAt: MeasureAt,
): StoredObject | undefined =>
  placeSticky(layoutSticky({ ...sticky, text: clampUtf8(text) }, measureAt));

export const restyleSticky = (
  sticky: Sticky,
  change: TextChange,
  measureAt: MeasureAt,
): StoredObject | undefined =>
  placeSticky(layoutSticky(applyTextChange(sticky, change), measureAt));

export const translateSticky = (sticky: Sticky, dx: number, dy: number): StoredObject | undefined =>
  placeSticky({
    ...sticky,
    bbox: {
      minX: sticky.bbox.minX + dx,
      minY: sticky.bbox.minY + dy,
      maxX: sticky.bbox.maxX + dx,
      maxY: sticky.bbox.maxY + dy,
    },
  });

export const scaleSticky = (
  sticky: Sticky,
  by: Scale,
  measureAt: MeasureAt,
): StoredObject | undefined => {
  const a = scaleAbout(by, { x: sticky.bbox.minX, y: sticky.bbox.minY });
  const b = scaleAbout(by, { x: sticky.bbox.maxX, y: sticky.bbox.maxY });
  const bbox: BBox = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  if (!(bbox.maxX > bbox.minX && bbox.maxY > bbox.minY)) return undefined;
  if (sticky.fit === "Auto") return placeSticky(layoutSticky({ ...sticky, bbox }, measureAt));
  const width = clampFont(sticky.width * Math.sqrt(Math.abs(by.sx * by.sy)));
  return placeSticky(fitHeight({ ...sticky, bbox, width }, measureAt));
};

export type ScreenRect = { x: number; y: number; width: number; height: number };

export const STICKY_SHADOW_COLOUR = "rgba(0, 0, 0, 0.18)";
export const STICKY_SHADOW_BLUR_PX = 6;
export const STICKY_SHADOW_OFFSET_X_PX = 0;
export const STICKY_SHADOW_OFFSET_Y_PX = 2;

const fitsCanvas = (ctx: CanvasRenderingContext2D, width: number, height: number): boolean => {
  const { a: scaleX, d: scaleY } = ctx.getTransform();
  const deviceArea = width * scaleX * (height * scaleY);
  return deviceArea <= ctx.canvas.width * ctx.canvas.height;
};

export const paintSticky = (
  ctx: CanvasRenderingContext2D,
  sticky: Sticky,
  lines: readonly string[],
  rect: ScreenRect,
  zoom: number,
  showText: boolean,
  bounds: BBox,
  oversized: boolean,
): void => {
  const visible = clipRect(
    { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height },
    bounds,
  );
  if (!visible) return;
  const { minX, minY, maxX, maxY } = visible;
  const shadowed = !oversized && fitsCanvas(ctx, maxX - minX, maxY - minY);
  if (shadowed) {
    ctx.shadowColor = STICKY_SHADOW_COLOUR;
    ctx.shadowBlur = STICKY_SHADOW_BLUR_PX;
    ctx.shadowOffsetX = STICKY_SHADOW_OFFSET_X_PX;
    ctx.shadowOffsetY = STICKY_SHADOW_OFFSET_Y_PX;
  }
  ctx.fillStyle = rgbHex(sticky.background);
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  if (shadowed) {
    ctx.shadowColor = "rgba(0, 0, 0, 0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  if (!showText) return;
  const { font, pad } = stickyMetrics(sticky);
  ctx.save();
  ctx.beginPath();
  ctx.rect(minX, minY, maxX - minX, maxY - minY);
  ctx.clip();
  paintLines(
    ctx,
    lines,
    { x: rect.x + pad * zoom, y: rect.y + pad * zoom },
    font * zoom,
    rgbHex(sticky.rgb),
    sticky,
    sticky.href !== undefined,
  );
  ctx.restore();
};
