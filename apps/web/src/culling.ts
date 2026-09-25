import { type BBox, isSubPixel } from "@stallion/geometry";

const intersects = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export const isVisible = (bbox: BBox, view: BBox, zoom: number): boolean =>
  intersects(bbox, view) && !isSubPixel(bbox, zoom);
