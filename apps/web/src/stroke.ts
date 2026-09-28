import type { StoredObject } from "@stallion/client-store";
import {
  type BBox,
  fromTileLocal,
  nativeLevel,
  type Point,
  place,
  TILE_SIZE,
  type Tile,
  toTileLocal,
} from "@stallion/geometry";
import {
  nearestColour,
  PALETTE_RGB,
  type PencilSize,
  rgbHex,
  type Stroke,
  type Point as StrokePoint,
} from "@stallion/schema";
import getStroke, { type StrokeOptions } from "perfect-freehand";

export const PALETTE: readonly string[] = PALETTE_RGB.map(rgbHex);

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

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const newObjectId = (): string => `${Date.now().toString(36).padStart(9, "0")}${randomHex(6)}`;

export type Draft = {
  objectId: string;
  rgb: number;
  size: PencilSize;
  nativeZoom: number;
  points: StrokePoint[];
};

export const startDraft = (rgb: number, size: PencilSize, zoom: number): Draft => ({
  objectId: newObjectId(),
  rgb,
  size,
  nativeZoom: nativeLevel(zoom),
  points: [],
});

export const continueDraft = (draft: Draft): Draft => {
  const last = draft.points.at(-1);
  return { ...draft, objectId: newObjectId(), points: last ? [last] : [] };
};

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

export const finishDraft = (draft: Draft): StoredObject | undefined => {
  if (draft.points.length === 0) return undefined;
  const bbox = draftBounds(draft);
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const { tile } = placed;
  const stroke: Stroke = {
    type: "Stroke",
    objectId: draft.objectId,
    nativeZoom: draft.nativeZoom,
    bbox,
    colour: nearestColour(draft.rgb),
    rgb: draft.rgb,
    size: draft.size,
    points: draft.points.map(([x, y, pressure]) => {
      const local = toTileLocal(tile, { x, y });
      return [local.x, local.y, pressure];
    }),
  };
  return { tile, object: stroke };
};

export type StrokeFrame = { origin: Point; scale: number; points: StrokePoint[] };

// Path2D keeps float32, so points live relative to the stroke bbox, never the tile.
export const strokeFrame = (tile: Tile, stroke: Stroke): StrokeFrame => {
  const { bbox } = stroke;
  const origin = { x: bbox.minX, y: bbox.minY };
  const extent = Math.max(
    bbox.maxX - bbox.minX,
    bbox.maxY - bbox.minY,
    strokeWorldWidth(stroke.size, stroke.nativeZoom),
  );
  const scale = extent / TILE_SIZE;
  const points = stroke.points.map(([x, y, pressure]): StrokePoint => {
    const world = fromTileLocal(tile, { x, y });
    return [(world.x - origin.x) / scale, (world.y - origin.y) / scale, pressure];
  });
  return { origin, scale, points };
};

export const strokeFramePath = (stroke: Stroke, frame: StrokeFrame): Path2D =>
  outlinePath(frame.points, strokeWorldWidth(stroke.size, stroke.nativeZoom) / frame.scale, true);

export const draftScreenPath = (
  draft: Pick<Draft, "size" | "nativeZoom" | "points">,
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

export const translateStroke = (
  tile: Tile,
  stroke: Stroke,
  dx: number,
  dy: number,
): StoredObject | undefined => {
  const bbox = {
    minX: stroke.bbox.minX + dx,
    minY: stroke.bbox.minY + dy,
    maxX: stroke.bbox.maxX + dx,
    maxY: stroke.bbox.maxY + dy,
  };
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const points = stroke.points.map(([x, y, pressure]): StrokePoint => {
    const world = fromTileLocal(tile, { x, y });
    const local = toTileLocal(placed.tile, { x: world.x + dx, y: world.y + dy });
    return [local.x, local.y, pressure];
  });
  return { tile: placed.tile, object: { ...stroke, bbox, points } };
};
