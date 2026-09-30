import { type BBox, MARKER_PX, type Point } from "@stallion/geometry";
import { ERASER_TOLERANCE_PX } from "./eraser";

export const LOCATOR_SEARCH_PX = 120;
export const SMALL_RADIUS_PX = 10;
export const LOCATOR_MAX = 5;
export const RIPPLE_PERIOD_MS = 1200;
export const RIPPLE_RINGS = 3;
export const RIPPLE_MIN_PX = 18;
export const RIPPLE_MAX_PX = 40;

export type Candidate = { x: number; y: number; radius: number; style: string };

export type Locator = Candidate & { strength: number };

export type Ring = { radius: number; alpha: number };

export const screenRadius = (bbox: BBox, zoom: number): number =>
  Math.max(MARKER_PX / 2, (Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * zoom) / 2);

export const isSmall = (radius: number): boolean => radius < SMALL_RADIUS_PX;

export function locate(candidates: Iterable<Candidate>, pointer: Point): Locator[] {
  const near: { candidate: Candidate; distance: number }[] = [];
  for (const candidate of candidates) {
    if (!isSmall(candidate.radius)) continue;
    const distance = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y);
    if (distance > LOCATOR_SEARCH_PX) continue;
    if (distance <= candidate.radius + ERASER_TOLERANCE_PX) return [];
    near.push({ candidate, distance });
  }
  return near
    .sort((a, b) => a.distance - b.distance)
    .slice(0, LOCATOR_MAX)
    .map(({ candidate, distance }, rank) => ({
      ...candidate,
      strength: rank === 0 ? 1 : 0.25 + 0.5 * (1 - distance / LOCATOR_SEARCH_PX),
    }));
}

export function rings(locator: Locator, elapsedMs: number): Ring[] {
  const from = locator.radius + 2;
  const to = Math.min(
    RIPPLE_MAX_PX,
    RIPPLE_MIN_PX + (RIPPLE_MAX_PX - RIPPLE_MIN_PX) * locator.strength,
  );
  const cycle = Math.max(0, elapsedMs) / RIPPLE_PERIOD_MS;
  return Array.from({ length: RIPPLE_RINGS }, (_, index) => {
    const phase = (((cycle - index / RIPPLE_RINGS) % 1) + 1) % 1;
    const started = cycle >= index / RIPPLE_RINGS;
    return {
      radius: from + (to - from) * phase,
      alpha: started ? locator.strength * (1 - phase) ** 2 : 0,
    };
  });
}
