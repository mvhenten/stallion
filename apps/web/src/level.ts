import { MAX_LEVEL, MIN_LEVEL, nativeLevel } from "@stallion/geometry";

export type LevelOption = { level: number; current: boolean; hasContent: boolean };

export const LEVEL_ANIMATION_MS = 250;

export const levelOf = (zoom: number): number => nativeLevel(zoom);

export const zoomForLevel = (level: number): number => 2 ** -level;

export function levelOptions(current: number, contentLevels: Iterable<number>): LevelOption[] {
  const content = new Set(contentLevels);
  const levels = [current, ...content];
  const deepest = Math.max(MIN_LEVEL, Math.min(...levels) - 1);
  const shallowest = Math.min(MAX_LEVEL, Math.max(...levels) + 1);
  return Array.from({ length: shallowest - deepest + 1 }, (_, index) => {
    const level = deepest + index;
    return { level, current: level === current, hasContent: content.has(level) };
  });
}

export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
