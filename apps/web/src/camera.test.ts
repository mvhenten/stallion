import { describe, expect, test } from "vitest";
import {
  type Camera,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pinch,
  screenToWorld,
  viewBounds,
  wheelFactor,
  worldToScreen,
  zoomAt,
} from "./camera";

const camera: Camera = { x: 100, y: -50, zoom: 2 };

describe("camera", () => {
  test("screen and world coordinates round-trip", () => {
    const world = screenToWorld(camera, { x: 40, y: 60 });
    expect(world).toEqual({ x: 120, y: -20 });
    expect(worldToScreen(camera, world)).toEqual({ x: 40, y: 60 });
  });

  test("view bounds span the viewport in world units", () => {
    expect(viewBounds(camera, 800, 600)).toEqual({ minX: 100, minY: -50, maxX: 500, maxY: 250 });
  });

  test("pan moves the world with the pointer", () => {
    const moved = pan(camera, 20, -10);
    expect(worldToScreen(moved, screenToWorld(camera, { x: 5, y: 5 }))).toEqual({ x: 25, y: -5 });
  });

  test("zoom keeps the anchor point under the pointer", () => {
    const anchor = { x: 300, y: 200 };
    const world = screenToWorld(camera, anchor);
    const zoomed = zoomAt(camera, anchor, 8);
    expect(zoomed.zoom).toBe(16);
    expect(worldToScreen(zoomed, world)).toEqual(anchor);
  });

  test("zoom clamps to the level range", () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 2 ** 80).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(camera, { x: 0, y: 0 }, 2 ** -80).zoom).toBe(MIN_ZOOM);
  });

  test("pinch keeps both fingers on the world points they started on", () => {
    const from = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ] as const;
    const to = [
      { x: 50, y: 150 },
      { x: 250, y: 150 },
    ] as const;
    const a = screenToWorld(camera, from[0]);
    const b = screenToWorld(camera, from[1]);
    const next = pinch(camera, from, to);
    expect(next.zoom).toBeCloseTo(4);
    expect(worldToScreen(next, a).x).toBeCloseTo(to[0].x);
    expect(worldToScreen(next, a).y).toBeCloseTo(to[0].y);
    expect(worldToScreen(next, b).x).toBeCloseTo(to[1].x);
  });

  test("pinch zooms around the midpoint and pans with it", () => {
    const from = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ] as const;
    const to = [
      { x: 50, y: 250 },
      { x: 450, y: 250 },
    ] as const;
    const centre = screenToWorld(camera, { x: 200, y: 100 });
    const next = pinch(camera, from, to);
    expect(next.zoom).toBeCloseTo(4);
    expect(worldToScreen(next, centre).x).toBeCloseTo(250);
    expect(worldToScreen(next, centre).y).toBeCloseTo(250);
    expect(pinch(camera, from, [to[0], to[0]]).zoom).toBe(camera.zoom);
  });

  test("wheel up zooms in, wheel down zooms out", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0));
  });
});
