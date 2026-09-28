import type { Point } from "./tile";

export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const ELLIPSE_ITERATIONS = 4;

// Distance to the outline, by the trig-free iteration on the ellipse's evolute.
export function ellipseDistance(p: Point, centre: Point, rx: number, ry: number): number {
  const px = Math.abs(p.x - centre.x);
  const py = Math.abs(p.y - centre.y);
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  if (a === 0 || b === 0) {
    return segmentDistance({ x: px, y: py }, { x: 0, y: 0 }, { x: a, y: b });
  }
  let tx = Math.SQRT1_2;
  let ty = Math.SQRT1_2;
  for (let i = 0; i < ELLIPSE_ITERATIONS; i++) {
    const x = a * tx;
    const y = b * ty;
    const ex = ((a * a - b * b) * tx ** 3) / a;
    const ey = ((b * b - a * a) * ty ** 3) / b;
    const r = Math.hypot(x - ex, y - ey);
    const q = Math.hypot(px - ex, py - ey);
    if (q === 0) break;
    tx = Math.min(1, Math.max(0, ((px - ex) * (r / q) + ex) / a));
    ty = Math.min(1, Math.max(0, ((py - ey) * (r / q) + ey) / b));
    const t = Math.hypot(tx, ty);
    tx /= t;
    ty /= t;
  }
  return Math.hypot(px - a * tx, py - b * ty);
}

export function insideEllipse(p: Point, centre: Point, rx: number, ry: number): boolean {
  if (rx === 0 || ry === 0) return false;
  return ((p.x - centre.x) / rx) ** 2 + ((p.y - centre.y) / ry) ** 2 <= 1;
}
