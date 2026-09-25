import { LIVE_TILE_MIN_PX, MAX_LEVEL, MIN_LEVEL, SUB_PIXEL_PX, TILE_SIZE } from "./constants";
import { type BBox, clampLevel, nativeLevel, tileIndex } from "./tile";

export type LevelRange = {
  level: number;
  minTx: number;
  minTy: number;
  maxTx: number;
  maxTy: number;
};

export type ViewTiles = { native: number; live: LevelRange[]; snapshot: LevelRange[] };

export function levelRange(level: number, bounds: BBox): LevelRange {
  return {
    level,
    minTx: tileIndex(level, bounds.minX),
    minTy: tileIndex(level, bounds.minY),
    maxTx: tileIndex(level, bounds.maxX),
    maxTy: tileIndex(level, bounds.maxY),
  };
}

function levelForScreenSize(px: number, zoom: number): number {
  return clampLevel(Math.ceil(Math.log2(px / (TILE_SIZE * zoom))));
}

export function finestLevel(zoom: number): number {
  return levelForScreenSize(SUB_PIXEL_PX, zoom);
}

export function finestLiveLevel(zoom: number): number {
  return levelForScreenSize(LIVE_TILE_MIN_PX, zoom);
}

export function viewTiles(bounds: BBox, zoom: number): ViewTiles {
  const native = nativeLevel(zoom);
  const liveFrom = finestLiveLevel(zoom);
  const live: LevelRange[] = [];
  const snapshot: LevelRange[] = [];
  for (let level = MAX_LEVEL; level >= Math.max(MIN_LEVEL, finestLevel(zoom)); level--) {
    (level >= liveFrom ? live : snapshot).push(levelRange(level, bounds));
  }
  return { native, live, snapshot };
}

export function isSubPixel(bbox: BBox, zoom: number): boolean {
  return Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * zoom < SUB_PIXEL_PX;
}
