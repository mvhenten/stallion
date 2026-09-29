import type { BBox } from "@stallion/geometry";

export type Vec = readonly [number, number];

export type Run = { points: Vec[]; offset: number };

export const inflate = (box: BBox, by: number): BBox => ({
  minX: box.minX - by,
  minY: box.minY - by,
  maxX: box.maxX + by,
  maxY: box.maxY + by,
});

const overlaps = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const exceeds = (box: BBox, view: BBox): boolean => {
  const margin = Math.max(view.maxX - view.minX, view.maxY - view.minY);
  const safe = inflate(view, margin);
  return (
    box.minX < safe.minX || box.minY < safe.minY || box.maxX > safe.maxX || box.maxY > safe.maxY
  );
};

export const clipRect = (box: BBox, view: BBox): BBox | undefined => {
  const clipped = {
    minX: Math.max(box.minX, view.minX),
    minY: Math.max(box.minY, view.minY),
    maxX: Math.min(box.maxX, view.maxX),
    maxY: Math.min(box.maxY, view.maxY),
  };
  return clipped.minX < clipped.maxX && clipped.minY < clipped.maxY ? clipped : undefined;
};

type Edge = { inside: (p: Vec) => boolean; cross: (a: Vec, b: Vec) => Vec };

const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

const edges = (box: BBox): Edge[] => [
  {
    inside: (p) => p[0] >= box.minX,
    cross: (a, b) => lerp(a, b, (box.minX - a[0]) / (b[0] - a[0])),
  },
  {
    inside: (p) => p[0] <= box.maxX,
    cross: (a, b) => lerp(a, b, (box.maxX - a[0]) / (b[0] - a[0])),
  },
  {
    inside: (p) => p[1] >= box.minY,
    cross: (a, b) => lerp(a, b, (box.minY - a[1]) / (b[1] - a[1])),
  },
  {
    inside: (p) => p[1] <= box.maxY,
    cross: (a, b) => lerp(a, b, (box.maxY - a[1]) / (b[1] - a[1])),
  },
];

// Sutherland-Hodgman keeps the nonzero winding of every point inside the box.
export const clipPolygon = (points: readonly Vec[], box: BBox): Vec[] => {
  let out: Vec[] = [...points];
  for (const edge of edges(box)) {
    const input = out;
    out = [];
    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length] ?? current;
      if (edge.inside(current)) {
        if (!edge.inside(previous)) out.push(edge.cross(previous, current));
        out.push(current);
        return;
      }
      if (edge.inside(previous)) out.push(edge.cross(previous, current));
    });
  }
  return out;
};

const clipSegment = (a: Vec, b: Vec, box: BBox): [number, number] | undefined => {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sides: [number, number][] = [
    [-dx, a[0] - box.minX],
    [dx, box.maxX - a[0]],
    [-dy, a[1] - box.minY],
    [dy, box.maxY - a[1]],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  return [t0, t1];
};

// Each run carries its distance along the whole path, so dashes keep their phase.
export const clipPolyline = (
  points: readonly Vec[],
  closed: boolean,
  box: BBox,
  lengths?: readonly number[],
): Run[] => {
  const runs: Run[] = [];
  let run: Run | undefined;
  let travelled = 0;
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    const length = lengths?.[index] ?? Math.hypot(b[0] - a[0], b[1] - a[1]);
    const span = clipSegment(a, b, box);
    if (!span) {
      run = undefined;
      travelled += length;
      continue;
    }
    const [t0, t1] = span;
    if (!run || t0 > 0) {
      run = { points: [lerp(a, b, t0)], offset: travelled + t0 * length };
      runs.push(run);
    }
    run.points.push(lerp(a, b, t1));
    if (t1 < 1) run = undefined;
    travelled += length;
  }
  return runs;
};

const GAUSS: readonly [number, number][] = [
  [0, 128 / 225],
  [-0.5384693101056831, 0.4786286704993665],
  [0.5384693101056831, 0.4786286704993665],
  [-0.906179845938664, 0.2369268850561891],
  [0.906179845938664, 0.2369268850561891],
];

const ELLIPSE_SPANS = 16;

const MAX_DEPTH = 48;

export type Flattened = { points: Vec[]; lengths: number[] };

// Refines only the arcs that reach the box, so a huge ellipse stays a few dozen points.
export const flattenEllipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  box: BBox,
  tolerance: number,
): Flattened => {
  const radius = Math.max(rx, ry);
  const points: Vec[] = [];
  const lengths: number[] = [];
  const at = (t: number): Vec => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  const arcLength = (t0: number, t1: number): number => {
    const half = (t1 - t0) / 2;
    const mid = (t0 + t1) / 2;
    return GAUSS.reduce(
      (sum, [x, w]) =>
        sum + w * half * Math.hypot(rx * Math.sin(mid + half * x), ry * Math.cos(mid + half * x)),
      0,
    );
  };
  const visit = (t0: number, t1: number, depth: number): void => {
    const a = at(t0);
    const b = at(t1);
    const sag = 2 * radius * Math.sin((t1 - t0) / 4) ** 2;
    const chord = {
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
    };
    if (sag <= tolerance || depth >= MAX_DEPTH || !overlaps(inflate(chord, sag), box)) {
      points.push(a);
      lengths.push(arcLength(t0, t1));
      return;
    }
    const mid = (t0 + t1) / 2;
    visit(t0, mid, depth + 1);
    visit(mid, t1, depth + 1);
  };
  const step = (Math.PI * 2) / ELLIPSE_SPANS;
  for (let span = 0; span < ELLIPSE_SPANS; span++) visit(span * step, (span + 1) * step, 0);
  return { points, lengths };
};

export const fillPolygon = (ctx: CanvasRenderingContext2D, points: readonly Vec[]): void => {
  const [first, ...rest] = points;
  if (!first || rest.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
};

export const strokeRuns = (
  ctx: CanvasRenderingContext2D,
  runs: readonly Run[],
  dash: readonly number[],
): void => {
  const period = dash.reduce((sum, length) => sum + length, 0) * (dash.length % 2 === 1 ? 2 : 1);
  ctx.setLineDash([...dash]);
  for (const { points, offset } of runs) {
    const [first, ...rest] = points;
    if (!first) continue;
    ctx.lineDashOffset = period > 0 ? offset % period : 0;
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.lineDashOffset = 0;
  ctx.setLineDash([]);
};
