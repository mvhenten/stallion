import type { BBox, Point } from "./tile";
import { isSubPixel } from "./view";

export const MARKER_PX = 2;
export const MARKER_ALPHA = 0.7;

export type Cull = "Draw" | "Marker" | "Skip";

export type Marker = { x: number; y: number; style: string };

const intersects = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export function cull(bbox: BBox, view: BBox, zoom: number): Cull {
  if (!intersects(bbox, view)) return "Skip";
  return isSubPixel(bbox, zoom) ? "Marker" : "Draw";
}

export const bboxCentre = (bbox: BBox): Point => ({
  x: (bbox.minX + bbox.maxX) / 2,
  y: (bbox.minY + bbox.maxY) / 2,
});

export function dedupeMarkers(markers: Iterable<Marker>): Marker[] {
  const cells = new Map<string, Marker>();
  for (const { x, y, style } of markers) {
    const cx = Math.floor(x / MARKER_PX);
    const cy = Math.floor(y / MARKER_PX);
    cells.set(`${cx}:${cy}`, { x: cx * MARKER_PX, y: cy * MARKER_PX, style });
  }
  return [...cells.values()];
}
