import {
  type BBox,
  contains,
  ellipseDistance,
  fromTileLocal,
  insideEllipse,
  type Point,
  segmentDistance,
  type Tile,
} from "@stallion/geometry";
import { FILLABLE, type Shape, type Stroke, widthOf } from "@stallion/schema";
import { shapeWorldPoints } from "./shape";
import { strokeWorldWidth } from "./stroke";

export const ERASER_TOLERANCE_PX = 8;

const pointBox = ({ x, y }: Point): BBox => ({ minX: x, minY: y, maxX: x, maxY: y });

const grow = (bbox: BBox, margin: number): BBox => ({
  minX: bbox.minX - margin,
  minY: bbox.minY - margin,
  maxX: bbox.maxX + margin,
  maxY: bbox.maxY + margin,
});

const reachOf = (object: Stroke | Shape, zoom: number): number =>
  ERASER_TOLERANCE_PX + (strokeWorldWidth(widthOf(object), object.nativeZoom) * zoom) / 2;

const ORIGIN: Point = { x: 0, y: 0 };

export const hitsStroke = (tile: Tile, stroke: Stroke, world: Point, zoom: number): boolean => {
  const reachPx = reachOf(stroke, zoom);
  if (!contains(grow(stroke.bbox, reachPx / zoom), pointBox(world))) return false;
  const screen = stroke.points.map(([x, y]) => {
    const point = fromTileLocal(tile, { x, y });
    return { x: (point.x - world.x) * zoom, y: (point.y - world.y) * zoom };
  });
  const [first] = screen;
  if (!first) return false;
  if (screen.length === 1) return Math.hypot(first.x, first.y) <= reachPx;
  return screen.some((point, index) => {
    const next = screen[index + 1];
    return next !== undefined && segmentDistance(ORIGIN, point, next) <= reachPx;
  });
};

export const hitsShape = (tile: Tile, shape: Shape, world: Point, zoom: number): boolean => {
  const reachPx = reachOf(shape, zoom);
  if (!contains(grow(shape.bbox, reachPx / zoom), pointBox(world))) return false;
  const points = shapeWorldPoints(tile, shape);
  const toScreen = (point: Point): Point => ({
    x: (point.x - world.x) * zoom,
    y: (point.y - world.y) * zoom,
  });
  const a = toScreen(points.start);
  const b = toScreen(points.end);
  const filled = shape.fill === "Tint" && FILLABLE[shape.kind];
  if (shape.kind === "Line" || shape.kind === "Arrow") {
    return segmentDistance(ORIGIN, a, b) <= reachPx;
  }
  if (shape.kind === "Ellipse") {
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    if (filled && insideEllipse(ORIGIN, centre, rx, ry)) return true;
    return ellipseDistance(ORIGIN, centre, rx, ry) <= reachPx;
  }
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const inside =
    Math.min(a.x, b.x) <= 0 &&
    0 <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= 0 &&
    0 <= Math.max(a.y, b.y);
  if (filled && inside) return true;
  return corners.some(
    (corner, index) =>
      segmentDistance(ORIGIN, corner, corners[(index + 1) % corners.length] ?? corner) <= reachPx,
  );
};

export const hitsFrame = (object: { bbox: BBox }, world: Point, zoom: number): boolean =>
  contains(grow(object.bbox, ERASER_TOLERANCE_PX / zoom), pointBox(world));
