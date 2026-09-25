import { type BBox, contains, fromTileLocal, type Point, type Tile } from "@stallion/geometry";
import type { Stroke } from "@stallion/schema";
import { strokeWorldWidth } from "./stroke";

export const ERASER_TOLERANCE_PX = 8;

const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const pointBox = ({ x, y }: Point): BBox => ({ minX: x, minY: y, maxX: x, maxY: y });

const grow = (bbox: BBox, margin: number): BBox => ({
  minX: bbox.minX - margin,
  minY: bbox.minY - margin,
  maxX: bbox.maxX + margin,
  maxY: bbox.maxY + margin,
});

export const hitsStroke = (tile: Tile, stroke: Stroke, world: Point, zoom: number): boolean => {
  const reachPx =
    ERASER_TOLERANCE_PX + (strokeWorldWidth(stroke.size, stroke.nativeZoom) * zoom) / 2;
  if (!contains(grow(stroke.bbox, reachPx / zoom), pointBox(world))) return false;
  const screen = stroke.points.map(([x, y]) => {
    const point = fromTileLocal(tile, { x, y });
    return { x: (point.x - world.x) * zoom, y: (point.y - world.y) * zoom };
  });
  const origin = { x: 0, y: 0 };
  const [first] = screen;
  if (!first) return false;
  if (screen.length === 1) return Math.hypot(first.x, first.y) <= reachPx;
  return screen.some((point, index) => {
    const next = screen[index + 1];
    return next !== undefined && segmentDistance(origin, point, next) <= reachPx;
  });
};
