import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  contains,
  cull,
  dedupeMarkers,
  ellipseDistance,
  fromTileLocal,
  insideEllipse,
  isSubPixel,
  MARKER_PX,
  MAX_LEVEL,
  MIN_LEVEL,
  nativeLevel,
  place,
  segmentDistance,
  tileBounds,
  tileKey,
  tileScreenSize,
  toTileLocal,
  viewTiles,
} from "./index";

const bbox = (minX: number, minY: number, w: number, h: number) => ({
  minX,
  minY,
  maxX: minX + w,
  maxY: minY + h,
});

describe("tiles", () => {
  test("native tiles are between 256 and 512 px on screen", () => {
    for (const zoom of [1, 0.3, 3, 2 ** -20, 1000]) {
      const px = tileScreenSize(nativeLevel(zoom), zoom);
      expect(px).toBeGreaterThanOrEqual(256);
      expect(px).toBeLessThan(512);
    }
  });

  test("native level clamps to the level range", () => {
    expect(nativeLevel(2 ** 60)).toBe(MIN_LEVEL);
    expect(nativeLevel(2 ** -60)).toBe(MAX_LEVEL);
  });

  test("keys and tile-local coordinates round-trip", () => {
    const tile = { level: -3, tx: -5, ty: 7 };
    expect(tileKey(tile)).toBe("-3:-5:7");
    const point = { x: -155, y: 230 };
    expect(fromTileLocal(tile, toTileLocal(tile, point))).toEqual(point);
  });
});

describe("placement", () => {
  test("uses the smallest tile that fits", () => {
    expect(place(bbox(10, 10, 100, 100))).toEqual({ ok: true, tile: { level: -1, tx: 0, ty: 0 } });
  });

  test("bumps a bbox that straddles a boundary to a coarser level", () => {
    const placed = place(bbox(250, 10, 10, 10));
    expect(placed).toEqual({ ok: true, tile: { level: 1, tx: 0, ty: 0 } });
  });

  test("places a bbox across the origin in the root tile", () => {
    expect(place(bbox(-1, -1, 2, 2))).toEqual({
      ok: true,
      tile: { level: MAX_LEVEL, tx: 0, ty: 0 },
    });
  });

  test("the placement tile holds the whole bbox", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (x, y, w, h) => {
          const box = bbox(x, y, w, h);
          const placed = place(box);
          return placed.ok && contains(tileBounds(placed.tile), box);
        },
      ),
    );
  });

  test("the coarser bump terminates within the level range", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e300, max: 1e300, noNaN: true }),
        fc.double({ min: -1e300, max: 1e300, noNaN: true }),
        fc.double({ min: 0, max: 1e300, noNaN: true }),
        (x, y, w) => {
          const placed = place(bbox(x, y, w, w));
          return !placed.ok || placed.tile.level <= MAX_LEVEL;
        },
      ),
    );
  });
});

describe("view", () => {
  const zoom = 1;
  const view = viewTiles({ minX: 0, minY: 0, maxX: 1024, maxY: 768 }, zoom);

  test("splits levels into a live band and a snapshot band down to the pixel cutoff", () => {
    expect(view.native).toBe(0);
    expect(view.live.at(0)?.level).toBe(MAX_LEVEL);
    expect(view.live.at(-1)?.level).toBe(-2);
    expect(view.snapshot.map((r) => r.level)).toEqual([-3, -4, -5, -6, -7, -8]);
    expect(view.live.find((r) => r.level === 0)).toEqual({
      level: 0,
      minTx: 0,
      minTy: 0,
      maxTx: 4,
      maxTy: 3,
    });
  });

  test("every visible object lands in a queried tile", () => {
    const ranges = [...view.live, ...view.snapshot];
    for (const box of [bbox(1000, 700, 2, 2), bbox(-50, -50, 100, 100), bbox(500, 500, 1e6, 3)]) {
      const placed = place(box);
      if (!placed.ok) throw new Error("placement overflowed");
      const { level, tx, ty } = placed.tile;
      const range = ranges.find((r) => r.level === level);
      expect(range).toBeDefined();
      expect(tx).toBeGreaterThanOrEqual(range?.minTx ?? Infinity);
      expect(tx).toBeLessThanOrEqual(range?.maxTx ?? -Infinity);
      expect(ty).toBeGreaterThanOrEqual(range?.minTy ?? Infinity);
      expect(ty).toBeLessThanOrEqual(range?.maxTy ?? -Infinity);
    }
  });

  test("flags objects below one pixel", () => {
    expect(isSubPixel(bbox(0, 0, 0.5, 0.5), zoom)).toBe(true);
    expect(isSubPixel(bbox(0, 0, 0.5, 0.5), 4)).toBe(false);
  });
});

describe("culling", () => {
  const view = bbox(0, 0, 100, 100);

  test("marks an object below one pixel and draws it from one pixel up", () => {
    expect(cull(bbox(50, 50, 0.999, 0.5), view, 1)).toBe("Marker");
    expect(cull(bbox(50, 50, 1, 0.5), view, 1)).toBe("Draw");
    expect(cull(bbox(50, 50, 1.5, 1.5), view, 1)).toBe("Draw");
    expect(cull(bbox(50, 50, 0.5, 0.5), view, 2)).toBe("Draw");
    expect(cull(bbox(50, 50, 0, 0), view, 1)).toBe("Marker");
  });

  test("skips an object outside the view and keeps one touching its edge", () => {
    expect(cull(bbox(101, 10, 20, 20), view, 1)).toBe("Skip");
    expect(cull(bbox(101, 10, 0.1, 0.1), view, 1)).toBe("Skip");
    expect(cull(bbox(100, 10, 20, 20), view, 1)).toBe("Draw");
    expect(cull(bbox(-1e9, -1e9, 2e9, 2e9), view, 1)).toBe("Draw");
  });

  test("a cluster inside one screen pixel is one marker", () => {
    const markers = dedupeMarkers([
      { x: 10.1, y: 20.2, style: "a" },
      { x: 11.9, y: 21.9, style: "b" },
      { x: 12, y: 20, style: "c" },
      { x: -0.5, y: 0, style: "d" },
    ]);
    expect(markers).toEqual([
      { x: 10, y: 20, style: "b" },
      { x: 12, y: 20, style: "c" },
      { x: -MARKER_PX, y: 0, style: "d" },
    ]);
  });
});

describe("distance", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  test("a segment measures to its nearest point, its ends included", () => {
    expect(segmentDistance({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(segmentDistance({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(segmentDistance({ x: 13, y: -4 }, a, b)).toBe(5);
    expect(segmentDistance({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  test("an ellipse measures to its outline from inside and outside", () => {
    const centre = { x: 100, y: 50 };
    expect(ellipseDistance({ x: 110, y: 50 }, centre, 10, 5)).toBeCloseTo(0, 6);
    expect(ellipseDistance({ x: 100, y: 55 }, centre, 10, 5)).toBeCloseTo(0, 6);
    expect(ellipseDistance({ x: 120, y: 50 }, centre, 10, 5)).toBeCloseTo(10, 6);
    expect(ellipseDistance({ x: 100, y: 50 }, centre, 10, 5)).toBeCloseTo(5, 6);
    expect(ellipseDistance({ x: 100, y: 42 }, centre, 10, 5)).toBeCloseTo(3, 6);
    expect(
      ellipseDistance({ x: 100 + 20 * Math.SQRT1_2, y: 50 + 20 * Math.SQRT1_2 }, centre, 10, 10),
    ).toBeCloseTo(10, 6);
  });

  test("an ellipse point on the outline is at distance zero at any angle", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        (angle, rx, ry) => {
          const p = { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
          return ellipseDistance(p, { x: 0, y: 0 }, rx, ry) < Math.max(rx, ry) * 1e-3;
        },
      ),
    );
  });

  test("a flat ellipse measures as the segment it collapses to", () => {
    expect(ellipseDistance({ x: 5, y: 3 }, a, 10, 0)).toBe(3);
    expect(insideEllipse({ x: 5, y: 0 }, a, 10, 0)).toBe(false);
  });

  test("the inside of an ellipse includes its centre and excludes its bbox corner", () => {
    expect(insideEllipse({ x: 0, y: 0 }, a, 10, 5)).toBe(true);
    expect(insideEllipse({ x: 9, y: 4.5 }, a, 10, 5)).toBe(false);
  });
});
