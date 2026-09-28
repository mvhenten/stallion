import type { StoredObject } from "@stallion/client-store";
import {
  type BBox,
  fromTileLocal,
  nativeLevel,
  type Point,
  place,
  type Tile,
  toTileLocal,
} from "@stallion/geometry";
import {
  FILLABLE,
  nearestColour,
  nearestSize,
  type Shape,
  type ShapeFill,
  type ShapeKind,
  type StrokeStyle,
  styleOf,
  widthOf,
} from "@stallion/schema";
import { dashPattern, HIGHLIGHTER_ALPHA, newObjectId, strokeWorldWidth } from "./stroke";

export const TINT_ALPHA = 0.2;

export const MIN_SHAPE_PX = 2;

const ARROW_HEAD_SPREAD = 0.5;

export const arrowHeadPx = (width: number): number => width * 3 + 8;

export type ShapeLook = {
  kind: ShapeKind;
  fill: ShapeFill;
  style: StrokeStyle;
  width: number;
  nativeZoom: number;
};

export type ShapeDraft = ShapeLook & { objectId: string; rgb: number; start: Point; end: Point };

export type ShapeInk = {
  kind: ShapeKind;
  filled: boolean;
  style: StrokeStyle;
  start: Point;
  end: Point;
  lineWidth: number;
  head: number;
};

export const shapeLook = (shape: Shape): ShapeLook => ({
  kind: shape.kind,
  fill: shape.fill,
  style: styleOf(shape),
  width: widthOf(shape),
  nativeZoom: shape.nativeZoom,
});

export const shapeWorldPoints = (tile: Tile, shape: Shape): { start: Point; end: Point } => ({
  start: fromTileLocal(tile, { x: shape.start[0], y: shape.start[1] }),
  end: fromTileLocal(tile, { x: shape.end[0], y: shape.end[1] }),
});

const shapeMargin = ({ kind, width, nativeZoom }: ShapeLook): number =>
  strokeWorldWidth(kind === "Arrow" ? Math.max(width, arrowHeadPx(width)) : width, nativeZoom);

export const shapeBounds = (look: ShapeLook, start: Point, end: Point): BBox => {
  const margin = shapeMargin(look);
  return {
    minX: Math.min(start.x, end.x) - margin,
    minY: Math.min(start.y, end.y) - margin,
    maxX: Math.max(start.x, end.x) + margin,
    maxY: Math.max(start.y, end.y) + margin,
  };
};

export const startShape = (
  kind: ShapeKind,
  fill: ShapeFill,
  rgb: number,
  width: number,
  style: StrokeStyle,
  zoom: number,
  at: Point,
): ShapeDraft => ({
  objectId: newObjectId(),
  kind,
  fill: FILLABLE[kind] ? fill : "None",
  rgb,
  width,
  style,
  nativeZoom: nativeLevel(zoom),
  start: at,
  end: at,
});

const placeShape = (
  base: Omit<Shape, "bbox" | "start" | "end">,
  look: ShapeLook,
  start: Point,
  end: Point,
): StoredObject | undefined => {
  const bbox = shapeBounds(look, start, end);
  const placed = place(bbox);
  if (!placed.ok) return undefined;
  const { tile } = placed;
  const localStart = toTileLocal(tile, start);
  const localEnd = toTileLocal(tile, end);
  return {
    tile,
    object: {
      ...base,
      bbox,
      start: [localStart.x, localStart.y],
      end: [localEnd.x, localEnd.y],
    },
  };
};

export const finishShape = (draft: ShapeDraft): StoredObject | undefined => {
  const { start, end } = draft;
  const extent = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  if (extent < strokeWorldWidth(MIN_SHAPE_PX, draft.nativeZoom)) return undefined;
  return placeShape(
    {
      type: "Shape",
      objectId: draft.objectId,
      nativeZoom: draft.nativeZoom,
      colour: nearestColour(draft.rgb),
      rgb: draft.rgb,
      size: nearestSize(draft.width),
      width: draft.width,
      style: draft.style,
      kind: draft.kind,
      fill: draft.fill,
    },
    draft,
    start,
    end,
  );
};

export const translateShape = (
  tile: Tile,
  shape: Shape,
  dx: number,
  dy: number,
): StoredObject | undefined => {
  const { start, end } = shapeWorldPoints(tile, shape);
  const { bbox: _bbox, start: _start, end: _end, ...base } = shape;
  return placeShape(
    base,
    shapeLook(shape),
    { x: start.x + dx, y: start.y + dy },
    { x: end.x + dx, y: end.y + dy },
  );
};

export const shapeScreenInk = (
  look: ShapeLook,
  start: Point,
  end: Point,
  toScreen: (world: Point) => Point,
  zoom: number,
): ShapeInk => ({
  kind: look.kind,
  filled: look.fill === "Tint" && FILLABLE[look.kind],
  style: look.style,
  start: toScreen(start),
  end: toScreen(end),
  lineWidth: strokeWorldWidth(look.width, look.nativeZoom) * zoom,
  head: strokeWorldWidth(arrowHeadPx(look.width), look.nativeZoom) * zoom,
});

type ArrowHead = { base: Point; wing: Point };

const outline = (ctx: CanvasRenderingContext2D, ink: ShapeInk): ArrowHead | undefined => {
  const { start, end } = ink;
  ctx.beginPath();
  if (ink.kind === "Rectangle") {
    ctx.rect(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    );
    return undefined;
  }
  if (ink.kind === "Ellipse") {
    ctx.ellipse(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2,
      Math.abs(end.y - start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    return undefined;
  }
  ctx.moveTo(start.x, start.y);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (ink.kind === "Line" || length === 0) {
    ctx.lineTo(end.x, end.y);
    return undefined;
  }
  const head = Math.min(ink.head, length);
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const base = { x: end.x - ux * head, y: end.y - uy * head };
  ctx.lineTo(base.x + ux * head * 0.2, base.y + uy * head * 0.2);
  return { base, wing: { x: -uy * head * ARROW_HEAD_SPREAD, y: ux * head * ARROW_HEAD_SPREAD } };
};

export const paintShape = (
  ctx: CanvasRenderingContext2D,
  ink: ShapeInk,
  colour: string,
  alpha = 1,
): void => {
  const highlighter = ink.style === "Highlighter";
  const base = highlighter ? alpha * HIGHLIGHTER_ALPHA : alpha;
  if (highlighter) ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = ink.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const arrowHead = outline(ctx, ink);
  if (ink.filled) {
    ctx.globalAlpha = base * TINT_ALPHA;
    ctx.fill();
  }
  ctx.globalAlpha = base;
  if (ink.style === "Dashed") ctx.setLineDash(dashPattern(ink.lineWidth));
  ctx.stroke();
  ctx.setLineDash([]);
  if (arrowHead) {
    const { base: b, wing } = arrowHead;
    ctx.beginPath();
    ctx.moveTo(ink.end.x, ink.end.y);
    ctx.lineTo(b.x + wing.x, b.y + wing.y);
    ctx.lineTo(b.x - wing.x, b.y - wing.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
};
