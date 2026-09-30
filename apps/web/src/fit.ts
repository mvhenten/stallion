import { LINE_HEIGHT, type Measure, wrapWorld } from "./wrap";

export type FitFrame = { width: number; height: number; padEm: number };

export type FontRange = { min: number; max: number };

const STEPS = 24;

export const fitsFrame = (
  text: string,
  font: number,
  frame: FitFrame,
  measureAt: (px: number) => Measure,
): boolean => {
  const pad = font * frame.padEm;
  const inner = frame.width - pad * 2;
  if (inner <= 0) return false;
  const lines = wrapWorld(text, inner, font, measureAt);
  return lines.length * font * LINE_HEIGHT + pad * 2 <= frame.height;
};

export const fitFont = (
  text: string,
  frame: FitFrame,
  range: FontRange,
  measureAt: (px: number) => Measure,
): number => {
  if (!fitsFrame(text, range.min, frame, measureAt)) return range.min;
  if (fitsFrame(text, range.max, frame, measureAt)) return range.max;
  let low = range.min;
  let high = range.max;
  for (let step = 0; step < STEPS; step++) {
    const middle = Math.sqrt(low * high);
    if (fitsFrame(text, middle, frame, measureAt)) low = middle;
    else high = middle;
  }
  return low;
};

const MEASURE_PX = 100;

export const fillFont = (
  text: string,
  width: number,
  range: FontRange,
  measureAt: (px: number) => Measure,
): number => {
  const measure = measureAt(MEASURE_PX);
  const widest = Math.max(...text.split("\n").map((line) => measure(line.trimEnd()) / MEASURE_PX));
  if (!(widest > 0)) return range.min;
  return Math.min(range.max, Math.max(range.min, width / widest));
};
