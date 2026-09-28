import type { StoredObject } from "@stallion/client-store";
import { type BBox, nativeLevel, type Point, place } from "@stallion/geometry";
import { clampUtf8, rgbHex, type Sticky } from "@stallion/schema";
import { newObjectId, type Scale, scaleAbout } from "./stroke";
import {
  clampFont,
  fontForScreen,
  LINE_HEIGHT,
  type Measure,
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

export const stickyLines = (sticky: Sticky, measureAt: (px: number) => Measure): string[] => {
  const { font, inner } = stickyMetrics(sticky);
  return wrapWorld(sticky.text, inner, font, measureAt);
};

const fitHeight = (sticky: Sticky, measureAt: (px: number) => Measure): Sticky => {
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
  };
};

export const startSticky = (
  background: number,
  zoom: number,
  centre: Point,
): StoredObject | undefined => placeSticky(newSticky(background, zoom, centre));

export const withText = (
  sticky: Sticky,
  text: string,
  measureAt: (px: number) => Measure,
): StoredObject | undefined =>
  placeSticky(fitHeight({ ...sticky, text: clampUtf8(text) }, measureAt));

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
  measureAt: (px: number) => Measure,
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
  const width = clampFont(sticky.width * Math.sqrt(Math.abs(by.sx * by.sy)));
  return placeSticky(fitHeight({ ...sticky, bbox, width }, measureAt));
};

export type ScreenRect = { x: number; y: number; width: number; height: number };

export const paintSticky = (
  ctx: CanvasRenderingContext2D,
  sticky: Sticky,
  lines: readonly string[],
  rect: ScreenRect,
  zoom: number,
  showText: boolean,
): void => {
  ctx.fillStyle = rgbHex(sticky.background);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (!showText) return;
  const { font, pad } = stickyMetrics(sticky);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  paintLines(
    ctx,
    lines,
    { x: rect.x + pad * zoom, y: rect.y + pad * zoom },
    font * zoom,
    rgbHex(sticky.rgb),
  );
  ctx.restore();
};
