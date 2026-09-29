import type { StoredObject } from "@stallion/client-store";
import {
  type BBox,
  nativeLevel,
  type Point,
  place,
  TILE_SIZE,
  type Tile,
  tileWorldSize,
} from "@stallion/geometry";
import { clampUtf8, MAX_WRAP_WIDTH, rgbHex, type Text } from "@stallion/schema";
import { newObjectId, type Scale, scaleAbout } from "./stroke";
import {
  fontForScreen,
  LINE_HEIGHT,
  type Measure,
  paintLines,
  widestWorld,
  worldFont,
  wrapWorld,
} from "./wrap";

export const TEXT_FONT_PX = 24;

export const TEXT_WRAP_PX = 320;

export const textWrap = (tile: Tile, text: Text): number =>
  (text.wrapWidth / TILE_SIZE) * tileWorldSize(tile.level);

export const textLines = (tile: Tile, text: Text, measureAt: (px: number) => Measure): string[] =>
  wrapWorld(text.text, textWrap(tile, text), worldFont(text), measureAt);

export const textInkBox = (
  text: Text,
  lines: readonly string[],
  measureAt: (px: number) => Measure,
): BBox => {
  const font = worldFont(text);
  const { minX, minY, maxY } = text.bbox;
  return { minX, minY, maxX: minX + Math.max(font, widestWorld(lines, font, measureAt)), maxY };
};

const placeText = (
  text: Text,
  at: Point,
  wrap: number,
  measureAt: (px: number) => Measure,
): StoredObject | undefined => {
  const font = worldFont(text);
  const width = Math.max(wrap, font);
  const lines = wrapWorld(text.text, width, font, measureAt);
  const bbox = {
    minX: at.x,
    minY: at.y,
    maxX: at.x + width,
    maxY: at.y + lines.length * font * LINE_HEIGHT,
  };
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const wrapWidth = Math.min(
    MAX_WRAP_WIDTH,
    (width / tileWorldSize(placed.tile.level)) * TILE_SIZE,
  );
  return { tile: placed.tile, object: { ...text, bbox, wrapWidth } };
};

const topLeft = (text: Text): Point => ({ x: text.bbox.minX, y: text.bbox.minY });

export const startText = (
  rgb: number,
  zoom: number,
  at: Point,
  measureAt: (px: number) => Measure,
): StoredObject | undefined => {
  const nativeZoom = nativeLevel(zoom);
  const width = fontForScreen(TEXT_FONT_PX, nativeZoom, zoom);
  const lineHeight = (TEXT_FONT_PX * LINE_HEIGHT) / zoom;
  const text: Text = {
    type: "Text",
    objectId: newObjectId(),
    nativeZoom,
    bbox: { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y },
    rgb,
    width,
    wrapWidth: MAX_WRAP_WIDTH,
    text: "",
  };
  return placeText(text, { x: at.x, y: at.y - lineHeight / 2 }, TEXT_WRAP_PX / zoom, measureAt);
};

export const withTextContent = (
  tile: Tile,
  text: Text,
  content: string,
  measureAt: (px: number) => Measure,
): StoredObject | undefined =>
  placeText({ ...text, text: clampUtf8(content) }, topLeft(text), textWrap(tile, text), measureAt);

export const translateText = (
  tile: Tile,
  text: Text,
  dx: number,
  dy: number,
  measureAt: (px: number) => Measure,
): StoredObject | undefined =>
  placeText(
    text,
    { x: text.bbox.minX + dx, y: text.bbox.minY + dy },
    textWrap(tile, text),
    measureAt,
  );

export const scaleText = (
  text: Text,
  by: Scale,
  measureAt: (px: number) => Measure,
): StoredObject | undefined => {
  const a = scaleAbout(by, topLeft(text));
  const b = scaleAbout(by, { x: text.bbox.maxX, y: text.bbox.minY });
  return placeText(
    text,
    { x: Math.min(a.x, b.x), y: text.bbox.minY },
    Math.abs(b.x - a.x),
    measureAt,
  );
};

export const paintText = (
  ctx: CanvasRenderingContext2D,
  text: Text,
  lines: readonly string[],
  origin: Point,
  zoom: number,
): void => paintLines(ctx, lines, origin, worldFont(text) * zoom, rgbHex(text.rgb));
