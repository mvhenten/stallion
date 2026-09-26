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

  test("pinch zooms around the anchor and pans with the midpoint", () => {
    const centre = screenToWorld(camera, { x: 200, y: 100 });
    const next = pinch(camera, { anchor: { x: 200, y: 100 }, factor: 2, dx: 50, dy: 150 });
    expect(next.zoom).toBeCloseTo(4);
    expect(worldToScreen(next, centre).x).toBeCloseTo(250);
    expect(worldToScreen(next, centre).y).toBeCloseTo(250);
    const parallel = pinch(camera, { anchor: { x: 200, y: 100 }, factor: 1, dx: 40, dy: 0 });
    expect(parallel.zoom).toBe(camera.zoom);
  });

  test("wheel up zooms in, wheel down zooms out", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0));
  });
});
