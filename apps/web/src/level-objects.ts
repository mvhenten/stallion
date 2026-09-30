import type { BBox, Point } from "@stallion/geometry";
import type { StallionObject } from "@stallion/schema";

export const LEVEL_OBJECTS_LIMIT = 20;

export const PREVIEW_WIDTH = 64;

export const PREVIEW_HEIGHT = 40;

export const PREVIEW_PAD_PX = 4;

export const FLYOUT_OPEN_MS = 400;

export const FLYOUT_CLOSE_MS = 200;

export const FLYOUT_WIDTH = 240;

export const FLYOUT_MAX_HEIGHT = 360;

const LABEL_CHARS = 24;

const FLYOUT_GAP = 8;

const GUTTER = 8;

export type LevelObject = { objectId: string; label: string; bbox: BBox };

export type LevelObjects = { items: LevelObject[]; more: number };

const distanceTo = ({ minX, minY, maxX, maxY }: BBox, { x, y }: Point): number =>
  Math.hypot((minX + maxX) / 2 - x, (minY + maxY) / 2 - y);

export function nearestFirst<T extends { bbox: BBox; objectId: string }>(
  items: readonly T[],
  centre: Point,
  limit: number = LEVEL_OBJECTS_LIMIT,
): { items: T[]; more: number } {
  const sorted = items
    .map((item) => ({ item, distance: distanceTo(item.bbox, centre) }))
    .sort((a, b) => a.distance - b.distance || (a.item.objectId < b.item.objectId ? -1 : 1))
    .map(({ item }) => item);
  return { items: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}

const snippet = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > LABEL_CHARS ? `${chars.slice(0, LABEL_CHARS).join("")}…` : flat;
};

export function objectLabel(object: StallionObject): string {
  if (object.type === "Shape") return object.kind;
  if (object.type === "Stroke") return "Stroke";
  const name = object.type === "Sticky" ? "Note" : "Text";
  const text = snippet(object.text);
  return text ? `${name}: ${text}` : name;
}

export type PreviewFit = { scale: number; x: number; y: number };

export function previewFit(
  extent: BBox,
  width: number = PREVIEW_WIDTH,
  height: number = PREVIEW_HEIGHT,
  pad: number = PREVIEW_PAD_PX,
): PreviewFit {
  const worldWidth = Math.max(extent.maxX - extent.minX, Number.EPSILON);
  const worldHeight = Math.max(extent.maxY - extent.minY, Number.EPSILON);
  const scale = Math.min((width - 2 * pad) / worldWidth, (height - 2 * pad) / worldHeight);
  const centreX = (extent.minX + extent.maxX) / 2;
  const centreY = (extent.minY + extent.maxY) / 2;
  return { scale, x: centreX - width / 2 / scale, y: centreY - height / 2 / scale };
}

export type Rect = { left: number; top: number; right: number; bottom: number };

export type FlyoutSide = "Right" | "Left" | "Below";

export type FlyoutPlacement = { side: FlyoutSide; left: number; top: number; maxHeight: number };

export function placeFlyout(
  option: Rect,
  list: Rect,
  viewport: { width: number; height: number },
  width: number = FLYOUT_WIDTH,
  desiredHeight: number = FLYOUT_MAX_HEIGHT,
): FlyoutPlacement {
  const fitsRight = list.right + FLYOUT_GAP + width <= viewport.width - GUTTER;
  const fitsLeft = list.left - FLYOUT_GAP - width >= GUTTER;
  const clampLeft = (left: number) =>
    Math.max(GUTTER, Math.min(left, viewport.width - GUTTER - width));
  if (!fitsRight && !fitsLeft) {
    const top = list.bottom + FLYOUT_GAP;
    return {
      side: "Below",
      left: clampLeft(list.left),
      top,
      maxHeight: Math.max(0, Math.floor(Math.min(desiredHeight, viewport.height - GUTTER - top))),
    };
  }
  const side = fitsRight ? "Right" : "Left";
  const left = side === "Right" ? list.right + FLYOUT_GAP : list.left - FLYOUT_GAP - width;
  const height = Math.min(desiredHeight, viewport.height - 2 * GUTTER);
  const top = Math.max(GUTTER, Math.min(option.top, viewport.height - GUTTER - height));
  return { side, left, top, maxHeight: Math.max(0, Math.floor(height)) };
}
