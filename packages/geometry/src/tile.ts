import { MAX_LEVEL, MIN_LEVEL, TILE_SIZE } from "./constants";

export type Point = { x: number; y: number };

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export type Tile = { level: number; tx: number; ty: number };

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) + 0;
}

export function tileWorldSize(level: number): number {
  return TILE_SIZE * 2 ** level;
}

export function gridOrigin(level: number): number {
  return level === MAX_LEVEL ? -tileWorldSize(MAX_LEVEL) / 2 : 0;
}

export function tileScreenSize(level: number, zoom: number): number {
  return tileWorldSize(level) * zoom;
}

export function nativeLevel(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    throw new RangeError(`zoom must be a positive finite number, got ${zoom}`);
  }
  return clampLevel(Math.ceil(-Math.log2(zoom)));
}

export function tileIndex(level: number, coordinate: number): number {
  return Math.floor((coordinate - gridOrigin(level)) / tileWorldSize(level)) + 0;
}

export function tileAt(level: number, point: Point): Tile {
  return { level, tx: tileIndex(level, point.x), ty: tileIndex(level, point.y) };
}

function tileMin(level: number, index: number): number {
  return gridOrigin(level) + index * tileWorldSize(level);
}

export function tileBounds(tile: Tile): BBox {
  return {
    minX: tileMin(tile.level, tile.tx),
    minY: tileMin(tile.level, tile.ty),
    maxX: tileMin(tile.level, tile.tx + 1),
    maxY: tileMin(tile.level, tile.ty + 1),
  };
}

export function tileKey(tile: Tile): string {
  return `${tile.level}:${tile.tx}:${tile.ty}`;
}

export function coarser(tile: Tile): Tile {
  const bounds = tileBounds(tile);
  return tileAt(tile.level + 1, { x: bounds.minX, y: bounds.minY });
}

export function toTileLocal(tile: Tile, point: Point): Point {
  const size = tileWorldSize(tile.level);
  return {
    x: ((point.x - tileMin(tile.level, tile.tx)) / size) * TILE_SIZE,
    y: ((point.y - tileMin(tile.level, tile.ty)) / size) * TILE_SIZE,
  };
}

export function fromTileLocal(tile: Tile, local: Point): Point {
  const size = tileWorldSize(tile.level);
  return {
    x: tileMin(tile.level, tile.tx) + (local.x / TILE_SIZE) * size,
    y: tileMin(tile.level, tile.ty) + (local.y / TILE_SIZE) * size,
  };
}

export function contains(outer: BBox, inner: BBox): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}
