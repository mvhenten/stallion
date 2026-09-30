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
import {
  clampUtf8,
  MAX_WIDTH,
  MAX_WRAP_WIDTH,
  MIN_WIDTH,
  rgbHex,
  type Text,
} from "@stallion/schema";
import { fillFont, fitFont } from "./fit";
import { newObjectId, type Scale, scaleAbout, strokeWorldWidth } from "./stroke";
import { applyTextChange, type TextChange } from "./text-change";
import {
  clampFont,
  fontForScreen,
  LINE_HEIGHT,
  type MeasureAt,
  measureIn,
  paintLines,
  widestWorld,
  worldFont,
  wrapWorld,
} from "./wrap";

export const TEXT_FONT_PX = 24;

export const TEXT_WRAP_PX = 320;

export const textWrap = (tile: Tile, text: Text): number =>
  (text.wrapWidth / TILE_SIZE) * tileWorldSize(tile.level);

export const textLines = (tile: Tile, text: Text, measureAt: MeasureAt): string[] =>
  wrapWorld(text.text, textWrap(tile, text), worldFont(text), measureIn(measureAt, text));

export const textInkBox = (text: Text, lines: readonly string[], measureAt: MeasureAt): BBox => {
  const font = worldFont(text);
  const { minX, minY } = text.bbox;
  const width = widestWorld(lines, font, measureIn(measureAt, text));
  return {
    minX,
    minY,
    maxX: minX + Math.max(font, width),
    maxY: minY + lines.length * font * LINE_HEIGHT,
  };
};

export const autoFitText = (
  text: Text,
  wrap: number,
  height: number,
  measureAt: MeasureAt,
): Text => {
  if (text.text.trim() === "") return text;
  const unit = strokeWorldWidth(1, text.nativeZoom);
  const range = { min: MIN_WIDTH * unit, max: MAX_WIDTH * unit };
  const measure = measureIn(measureAt, text);
  const font = Math.max(
    fillFont(text.text, wrap, range, measure),
    fitFont(text.text, { width: wrap, height, padEm: 0 }, range, measure),
  );
  return { ...text, width: clampFont(font / unit) };
};

const frameHeight = (text: Text): number | undefined =>
  text.fit === "Auto" ? text.bbox.maxY - text.bbox.minY : undefined;

const placeText = (
  source: Text,
  at: Point,
  wrap: number,
  measureAt: MeasureAt,
  height = frameHeight(source),
): StoredObject | undefined => {
  const text =
    source.fit === "Auto" && height !== undefined
      ? autoFitText(source, wrap, height, measureAt)
      : source;
  const font = worldFont(text);
  const width = Math.max(wrap, font);
  const lines = wrapWorld(text.text, width, font, measureIn(measureAt, text));
  const linesHeight = lines.length * font * LINE_HEIGHT;
  const bbox = {
    minX: at.x,
    minY: at.y,
    maxX: at.x + width,
    maxY: at.y + (text.fit === "Auto" ? Math.max(linesHeight, height ?? 0) : linesHeight),
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
  measureAt: MeasureAt,
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
    font: "Sans",
    bold: false,
    italic: false,
    fit: "Fixed",
  };
  return placeText(text, { x: at.x, y: at.y - lineHeight / 2 }, TEXT_WRAP_PX / zoom, measureAt);
};

export const withTextContent = (
  tile: Tile,
  text: Text,
  content: string,
  measureAt: MeasureAt,
): StoredObject | undefined =>
  placeText({ ...text, text: clampUtf8(content) }, topLeft(text), textWrap(tile, text), measureAt);

export const restyleText = (
  tile: Tile,
  text: Text,
  change: TextChange,
  measureAt: MeasureAt,
): StoredObject | undefined =>
  placeText(applyTextChange(text, change), topLeft(text), textWrap(tile, text), measureAt);

export const translateText = (
  tile: Tile,
  text: Text,
  dx: number,
  dy: number,
  measureAt: MeasureAt,
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
  measureAt: MeasureAt,
): StoredObject | undefined => {
  if (text.fit === "Auto") {
    const a = scaleAbout(by, topLeft(text));
    const b = scaleAbout(by, { x: text.bbox.maxX, y: text.bbox.maxY });
    const height = Math.abs(b.y - a.y);
    if (!(height > 0)) return undefined;
    return placeText(
      text,
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      Math.abs(b.x - a.x),
      measureAt,
      height,
    );
  }
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
): void =>
  paintLines(
    ctx,
    lines,
    origin,
    worldFont(text) * zoom,
    rgbHex(text.rgb),
    text,
    text.href !== undefined,
  );
