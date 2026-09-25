import type { BBox, Point } from "@stallion/geometry";
import { MAX_LEVEL, MIN_LEVEL } from "@stallion/geometry";

export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 2 ** -MAX_LEVEL;
export const MAX_ZOOM = 2 ** -MIN_LEVEL;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const screenToWorld = (camera: Camera, screen: Point): Point => ({
  x: camera.x + screen.x / camera.zoom,
  y: camera.y + screen.y / camera.zoom,
});

export const worldToScreen = (camera: Camera, world: Point): Point => ({
  x: (world.x - camera.x) * camera.zoom,
  y: (world.y - camera.y) * camera.zoom,
});

export const viewBounds = (camera: Camera, width: number, height: number): BBox => ({
  minX: camera.x,
  minY: camera.y,
  maxX: camera.x + width / camera.zoom,
  maxY: camera.y + height / camera.zoom,
});

export const pan = (camera: Camera, dx: number, dy: number): Camera => ({
  x: camera.x - dx / camera.zoom,
  y: camera.y - dy / camera.zoom,
  zoom: camera.zoom,
});

export const zoomAt = (camera: Camera, screen: Point, factor: number): Camera => {
  const anchor = screenToWorld(camera, screen);
  const zoom = clampZoom(camera.zoom * factor);
  return { x: anchor.x - screen.x / zoom, y: anchor.y - screen.y / zoom, zoom };
};

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const pinch = (
  camera: Camera,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): Camera => {
  const start = midpoint(...from);
  const end = midpoint(...to);
  const spread = distance(...from);
  const factor = spread > 0 ? distance(...to) / spread : 1;
  return pan(zoomAt(camera, start, factor), end.x - start.x, end.y - start.y);
};

export const wheelFactor = (deltaY: number, deltaMode: number): number => {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return 2 ** (-pixels / 300);
};
