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
  MAX_WIDTH,
  MIN_WIDTH,
  nearestColour,
  nearestSize,
  PALETTE_RGB,
  type PencilSize,
  rgbHex,
  type Stroke,
  type Point as StrokePoint,
  type StrokeStyle,
  styleOf,
  widthOf,
} from "@stallion/schema";
import getStroke, { type StrokeOptions } from "perfect-freehand";
import { clipPolygon, clipPolyline, fillPolygon, inflate, strokeRuns, type Vec } from "./clip";

export const PALETTE: readonly string[] = PALETTE_RGB.map(rgbHex);

export const PENCIL_SIZES: readonly PencilSize[] = ["Small", "Medium", "Large"];

export const WIDTH_PRESETS: readonly number[] = [0.5, 1, 2, 40, 60, 96];

export const WIDTH_SLIDER_STEPS = 100;

const WIDTH_SPAN = Math.log(MAX_WIDTH / MIN_WIDTH);

const roundWidth = (width: number): number =>
  width < 4 ? Math.round(width * 2) / 2 : Math.round(width);

export const clampWidth = (width: number): number =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, roundWidth(width)));

export const sliderToWidth = (step: number): number =>
  clampWidth(MIN_WIDTH * Math.exp((step / WIDTH_SLIDER_STEPS) * WIDTH_SPAN));

export const widthToSlider = (width: number): number =>
  Math.round((Math.log(clampWidth(width) / MIN_WIDTH) / WIDTH_SPAN) * WIDTH_SLIDER_STEPS);

export const MAX_POINTS = 4096;

export const strokeWorldWidth = (width: number, nativeZoom: number): number =>
  width * 2 ** (nativeZoom - 0.5);

const strokeOptions = (size: number, last: boolean): StrokeOptions => ({
  size,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.4,
  simulatePressure: false,
  last,
});

export const HIGHLIGHTER_ALPHA = 0.4;

export const UNIFORM_PRESSURE = 0.5;

const outlineOf = (points: readonly StrokePoint[], size: number, last: boolean): Vec[] =>
  getStroke([...points], strokeOptions(size, last)).map(([x, y]): Vec => [x ?? 0, y ?? 0]);

const polygonPath = (outline: readonly Vec[]): Path2D => {
  const path = new Path2D();
  const [first, ...rest] = outline;
  if (!first) return path;
  path.moveTo(first[0], first[1]);
  for (const [x, y] of rest) path.lineTo(x, y);
  path.closePath();
  return path;
};

export const outlinePath = (points: readonly StrokePoint[], size: number, last: boolean): Path2D =>
  polygonPath(outlineOf(points, size, last));

const centrelinePath = (points: readonly Vec[]): Path2D => {
  const path = new Path2D();
  const [first, ...rest] = points;
  if (!first) return path;
  path.moveTo(first[0], first[1]);
  if (rest.length === 0) path.lineTo(first[0], first[1]);
  for (const [x, y] of rest) path.lineTo(x, y);
  return path;
};

export type StrokeInk = {
  style: StrokeStyle;
  path: Path2D;
  lineWidth: number;
  points: readonly Vec[];
};

export type InkClip = { scale: number; x: number; y: number; bounds: BBox };

export const strokeInk = (
  style: StrokeStyle,
  points: readonly StrokePoint[],
  size: number,
  last: boolean,
): StrokeInk => {
  if (style === "Dashed") {
    const centre = points.map(([x, y]): Vec => [x, y]);
    const [only] = centre;
    if (centre.length === 1 && only) centre.push(only);
    return { style, path: centrelinePath(centre), lineWidth: size, points: centre };
  }
  const pressed =
    style === "Uniform" ? points.map(([x, y]): StrokePoint => [x, y, UNIFORM_PRESSURE]) : points;
  const outline = outlineOf(pressed, size, last);
  return { style, path: polygonPath(outline), lineWidth: size, points: outline };
};

export const dashPattern = (lineWidth: number): number[] => [lineWidth, lineWidth * 2.5];

const paintClipped = (
  ctx: CanvasRenderingContext2D,
  ink: StrokeInk,
  colour: string,
  { scale, x, y, bounds }: InkClip,
): void => {
  const placed = ink.points.map(([px, py]): Vec => [px * scale + x, py * scale + y]);
  if (ink.style !== "Dashed") {
    ctx.fillStyle = colour;
    fillPolygon(ctx, clipPolygon(placed, inflate(bounds, 1)));
    return;
  }
  const lineWidth = ink.lineWidth * scale;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const runs = clipPolyline(placed, false, inflate(bounds, lineWidth / 2 + 1));
  strokeRuns(ctx, runs, dashPattern(lineWidth));
};

export const paintInk = (
  ctx: CanvasRenderingContext2D,
  ink: StrokeInk,
  colour: string,
  alpha = 1,
  clip?: InkClip,
): void => {
  const highlighter = ink.style === "Highlighter";
  ctx.globalAlpha = highlighter ? alpha * HIGHLIGHTER_ALPHA : alpha;
  if (highlighter) ctx.globalCompositeOperation = "multiply";
  if (clip) {
    paintClipped(ctx, ink, colour, clip);
  } else if (ink.style === "Dashed") {
    ctx.strokeStyle = colour;
    ctx.lineWidth = ink.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dashPattern(ink.lineWidth));
    ctx.stroke(ink.path);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = colour;
    ctx.fill(ink.path);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
};

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export const newObjectId = (): string =>
  `${Date.now().toString(36).padStart(9, "0")}${randomHex(6)}`;

export type Draft = {
  objectId: string;
  rgb: number;
  width: number;
  style: StrokeStyle;
  nativeZoom: number;
  points: StrokePoint[];
};

export const startDraft = (
  rgb: number,
  width: number,
  style: StrokeStyle,
  zoom: number,
): Draft => ({
  objectId: newObjectId(),
  rgb,
  width,
  style,
  nativeZoom: nativeLevel(zoom),
  points: [],
});

export const continueDraft = (draft: Draft): Draft => {
  const last = draft.points.at(-1);
  return { ...draft, objectId: newObjectId(), points: last ? [last] : [] };
};

const pointsBounds = (points: readonly StrokePoint[], margin: number): BBox => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  };
};

export const finishDraft = (draft: Draft): StoredObject | undefined => {
  if (draft.points.length === 0) return undefined;
  const bbox = pointsBounds(draft.points, strokeWorldWidth(draft.width, draft.nativeZoom));
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
    size: nearestSize(draft.width),
    width: draft.width,
    style: draft.style,
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
    strokeWorldWidth(widthOf(stroke), stroke.nativeZoom),
  );
  const scale = extent / TILE_SIZE;
  const points = stroke.points.map(([x, y, pressure]): StrokePoint => {
    const world = fromTileLocal(tile, { x, y });
    return [(world.x - origin.x) / scale, (world.y - origin.y) / scale, pressure];
  });
  return { origin, scale, points };
};

export const strokeFrameInk = (stroke: Stroke, frame: StrokeFrame): StrokeInk =>
  strokeInk(
    styleOf(stroke),
    frame.points,
    strokeWorldWidth(widthOf(stroke), stroke.nativeZoom) / frame.scale,
    true,
  );

export const draftScreenInk = (
  draft: Pick<Draft, "width" | "style" | "nativeZoom" | "points">,
  toScreen: (world: Point) => Point,
  zoom: number,
): StrokeInk =>
  strokeInk(
    draft.style,
    draft.points.map(([x, y, pressure]) => {
      const screen = toScreen({ x, y });
      return [screen.x, screen.y, pressure];
    }),
    strokeWorldWidth(draft.width, draft.nativeZoom) * zoom,
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

export type Scale = { anchor: Point; sx: number; sy: number };

export const scaleAbout = ({ anchor, sx, sy }: Scale, point: Point): Point => ({
  x: anchor.x + (point.x - anchor.x) * sx,
  y: anchor.y + (point.y - anchor.y) * sy,
});

const worldPoints = (tile: Tile, stroke: Stroke): StrokePoint[] =>
  stroke.points.map(([x, y, pressure]): StrokePoint => {
    const world = fromTileLocal(tile, { x, y });
    return [world.x, world.y, pressure];
  });

export const strokeExtent = (tile: Tile, stroke: Stroke): BBox =>
  pointsBounds(worldPoints(tile, stroke), 0);

export const scaleStroke = (tile: Tile, stroke: Stroke, scale: Scale): StoredObject | undefined => {
  const scaled = worldPoints(tile, stroke).map(([x, y, pressure]): StrokePoint => {
    const world = scaleAbout(scale, { x, y });
    return [world.x, world.y, pressure];
  });
  const bbox = pointsBounds(scaled, strokeWorldWidth(widthOf(stroke), stroke.nativeZoom));
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const points = scaled.map(([x, y, pressure]): StrokePoint => {
    const local = toTileLocal(placed.tile, { x, y });
    return [local.x, local.y, pressure];
  });
  return { tile: placed.tile, object: { ...stroke, bbox, points } };
};
