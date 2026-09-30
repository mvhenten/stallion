import { describe, expect, test, vi } from "vitest";
import {
  clipPolygon,
  clipPolyline,
  exceeds,
  flattenEllipse,
  inflate,
  strokeRuns,
  type Vec,
} from "./clip";
import { paintShape } from "./shape";
import { dashPattern, paintInk, strokeInk } from "./stroke";

const VIEW = { minX: 0, minY: 0, maxX: 2880, maxY: 1800 };

const inside = (points: readonly Vec[], by: number): boolean =>
  points.every(
    ([x, y]) =>
      x >= VIEW.minX - by && x <= VIEW.maxX + by && y >= VIEW.minY - by && y <= VIEW.maxY + by,
  );

type Recorded = { points: Vec[]; fills: number; strokes: number; dashes: number[][] };

const recorder = () => {
  const log: Recorded = { points: [], fills: 0, strokes: 0, dashes: [] };
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: (x: number, y: number) => log.points.push([x, y]),
    lineTo: (x: number, y: number) => log.points.push([x, y]),
    rect: () => {
      throw new Error("an oversized shape reached the canvas as a rect");
    },
    ellipse: () => {
      throw new Error("an oversized shape reached the canvas as an ellipse");
    },
    fill: () => {
      log.fills++;
    },
    stroke: () => {
      log.strokes++;
    },
    setLineDash: (dash: number[]) => log.dashes.push(dash),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
};

describe("clipPolygon", () => {
  test("cuts a polygon a thousand times the view down to the view", () => {
    const square: Vec[] = [
      [-1e6, -1e6],
      [1e6, -1e6],
      [1e6, 1e6],
      [-1e6, 1e6],
    ];
    const clipped = clipPolygon(square, VIEW);
    expect(inside(clipped, 0)).toBe(true);
    expect(clipped).toHaveLength(4);
  });

  test("drops a polygon outside the view", () => {
    const off: Vec[] = [
      [5000, 5000],
      [6000, 5000],
      [6000, 6000],
    ];
    expect(clipPolygon(off, VIEW)).toEqual([]);
  });
});

describe("clipPolyline", () => {
  test("keeps each visible run's distance along the path for the dash phase", () => {
    const line: Vec[] = [
      [-1e6, 900],
      [1e6, 900],
    ];
    const runs = clipPolyline(line, false, VIEW);
    expect(runs).toEqual([
      {
        points: [
          [0, 900],
          [2880, 900],
        ],
        offset: 1e6,
      },
    ]);
  });

  test("a closed outline around the view leaves no run on screen", () => {
    const frame: Vec[] = [
      [-10, -10],
      [3000, -10],
      [3000, 2000],
      [-10, 2000],
    ];
    expect(clipPolyline(frame, true, VIEW)).toEqual([]);
  });
});

describe("flattenEllipse", () => {
  test("refines only the arcs that reach the view", () => {
    const { points, lengths } = flattenEllipse(1440 + 2.68e5, 900, 2.68e5, 1.6e5, VIEW, 0.1);
    expect(points.length).toBeLessThan(200);
    const perimeter = lengths.reduce((sum, length) => sum + length, 0);
    const a = 2.68e5;
    const b = 1.6e5;
    const ramanujan = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    expect(perimeter / ramanujan).toBeCloseTo(1, 5);
    for (const [x, y] of points) {
      expect(((x - 1440 - a) / a) ** 2 + ((y - 900) / b) ** 2).toBeCloseTo(1, 9);
    }
  });
});

describe("exceeds", () => {
  test("a box within one view of the screen is drawn as is", () => {
    expect(exceeds(inflate(VIEW, 2000), VIEW)).toBe(false);
    expect(exceeds(inflate(VIEW, 3000), VIEW)).toBe(true);
  });
});

describe("level -9 on a 2880x1800 canvas", () => {
  vi.stubGlobal(
    "Path2D",
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    },
  );

  test("a 96 px highlighter reaches the canvas as a polygon inside the view", () => {
    const points = Array.from({ length: 20 }, (_, i): [number, number, number] => [
      i * 12,
      128 + Math.sin(i) * 20,
      0.5,
    ]);
    const ink = strokeInk("Highlighter", points, 26, true);
    const { ctx, log } = recorder();
    paintInk(ctx, ink, "#ffd400", 1, { scale: 3893, x: -4.97e5, y: -4.99e5, bounds: VIEW });
    expect(log.fills).toBe(1);
    expect(inside(log.points, 1)).toBe(true);
  });

  test("a dashed ellipse strokes a few dashes, all near the view", () => {
    const { ctx, log } = recorder();
    const lineWidth = 6024;
    paintShape(
      ctx,
      {
        kind: "Ellipse",
        filled: true,
        fillColour: undefined,
        outline: true,
        opacity: 1,
        style: "Dashed",
        start: { x: 1440 - 2 * 2.15e5, y: 900 - 1.09e5 },
        end: { x: 1440, y: 900 + 1.09e5 },
        lineWidth,
        head: 0,
      },
      "#1f2328",
      1,
      VIEW,
    );
    expect(inside(log.points, lineWidth / 2 + 1)).toBe(true);
    expect(log.dashes).toContainEqual(dashPattern(lineWidth));
    expect(log.strokes).toBeLessThan(10);
  });

  test("the selection box of a level-0 stroke keeps its dash count to the view", () => {
    const { ctx, log } = recorder();
    const corners: Vec[] = [
      [-5e5, -1e5],
      [5e5, -1e5],
      [5e5, 1.5e5],
      [-5e5, 1.5e5],
    ];
    strokeRuns(ctx, clipPolyline(corners, true, inflate(VIEW, 2)), [4, 4]);
    expect(log.strokes).toBe(0);
    const within: Vec[] = [
      [-5e5, 900],
      [5e5, 900],
      [5e5, 1.5e5],
      [-5e5, 1.5e5],
    ];
    strokeRuns(ctx, clipPolyline(within, true, inflate(VIEW, 2)), [4, 4]);
    expect(log.strokes).toBe(1);
    expect(inside(log.points, 3)).toBe(true);
  });
});
