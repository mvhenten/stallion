import type { StoredObject } from "@stallion/client-store";
import {
  type BBox,
  nativeLevel,
  type Point,
  place,
  TILE_SIZE,
  type Tile,
  tileWorldSize,
  toTileLocal,
} from "@stallion/geometry";
import type { PencilSize, Stroke, Point as StrokePoint } from "@stallion/schema";
import getStroke, { type StrokeOptions } from "perfect-freehand";

export const PALETTE = ["#1f2328", "#e5484d", "#f76b15", "#30a46c", "#0090ff", "#8e4ec6"] as const;

export const PENCIL_SIZES: readonly PencilSize[] = ["Small", "Medium", "Large"];

const PENCIL_PX: Record<PencilSize, number> = { Small: 3, Medium: 8, Large: 20 };

export const MAX_POINTS = 4096;

export const strokeWorldWidth = (size: PencilSize, nativeZoom: number): number =>
  PENCIL_PX[size] * 2 ** (nativeZoom - 0.5);

const strokeOptions = (size: number, last: boolean): StrokeOptions => ({
  size,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.4,
  simulatePressure: false,
  last,
});

export const outlinePath = (
  points: readonly StrokePoint[],
  size: number,
  last: boolean,
): Path2D => {
  const outline = getStroke([...points], strokeOptions(size, last));
  const path = new Path2D();
  const [first, ...rest] = outline;
  if (!first) return path;
  path.moveTo(first[0], first[1]);
  for (const [x, y] of rest) path.lineTo(x, y);
  path.closePath();
  return path;
};

export type Draft = {
  colour: number;
  size: PencilSize;
  nativeZoom: number;
  points: StrokePoint[];
};

export const startDraft = (colour: number, size: PencilSize, zoom: number): Draft => ({
  colour,
  size,
  nativeZoom: nativeLevel(zoom),
  points: [],
});

const draftBounds = (draft: Draft): BBox => {
  const margin = strokeWorldWidth(draft.size, draft.nativeZoom);
  const xs = draft.points.map((p) => p[0]);
  const ys = draft.points.map((p) => p[1]);
  return {
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  };
};

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const newObjectId = (): string => `${Date.now().toString(36).padStart(9, "0")}${randomHex(6)}`;

export const finishDraft = (draft: Draft): StoredObject | undefined => {
  if (draft.points.length === 0) return undefined;
  const bbox = draftBounds(draft);
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const { tile } = placed;
  const stroke: Stroke = {
    type: "Stroke",
    objectId: newObjectId(),
    nativeZoom: draft.nativeZoom,
    bbox,
    colour: draft.colour,
    size: draft.size,
    points: draft.points.map(([x, y, pressure]) => {
      const local = toTileLocal(tile, { x, y });
      return [local.x, local.y, pressure];
    }),
  };
  return { tile, object: stroke };
};

export const localScale = (tile: Tile): number => tileWorldSize(tile.level) / TILE_SIZE;

export const strokeLocalPath = (tile: Tile, stroke: Stroke): Path2D =>
  outlinePath(
    stroke.points,
    strokeWorldWidth(stroke.size, stroke.nativeZoom) / localScale(tile),
    true,
  );

export const draftScreenPath = (
  draft: Draft,
  toScreen: (world: Point) => Point,
  zoom: number,
): Path2D =>
  outlinePath(
    draft.points.map(([x, y, pressure]) => {
      const screen = toScreen({ x, y });
      return [screen.x, screen.y, pressure];
    }),
    strokeWorldWidth(draft.size, draft.nativeZoom) * zoom,
    false,
  );
