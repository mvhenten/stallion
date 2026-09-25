import { MAX_LEVEL, MIN_LEVEL, TILE_SIZE } from "./constants";
import { type BBox, contains, type Tile, tileAt, tileBounds } from "./tile";

export type Placement = { ok: true; tile: Tile } | { ok: false; reason: "Overflow" };

function startLevel(bbox: BBox): number {
  const extent = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (!(extent > 0)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.ceil(Math.log2(extent / TILE_SIZE))));
}

export function place(bbox: BBox): Placement {
  for (let level = startLevel(bbox); level <= MAX_LEVEL; level++) {
    const tile = tileAt(level, { x: bbox.minX, y: bbox.minY });
    if (contains(tileBounds(tile), bbox)) return { ok: true, tile };
  }
  return { ok: false, reason: "Overflow" };
}
