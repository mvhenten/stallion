import { PAPER } from "./surface";

export const THUMBNAIL_WIDTH = 160;

const BLANK_TOLERANCE = 4;

const paperRgb = (() => {
  const hex = PAPER.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
})();

const isBlank = (data: Uint8ClampedArray): boolean => {
  for (let i = 0; i < data.length; i += 4) {
    const dr = Math.abs((data[i] ?? 0) - paperRgb.r);
    const dg = Math.abs((data[i + 1] ?? 0) - paperRgb.g);
    const db = Math.abs((data[i + 2] ?? 0) - paperRgb.b);
    if (dr > BLANK_TOLERANCE || dg > BLANK_TOLERANCE || db > BLANK_TOLERANCE) return false;
  }
  return true;
};

export const captureThumbnail = (canvas: HTMLCanvasElement): string | undefined => {
  if (canvas.width === 0 || canvas.height === 0) return undefined;
  const width = THUMBNAIL_WIDTH;
  const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(canvas, 0, 0, width, height);
  if (isBlank(ctx.getImageData(0, 0, width, height).data)) return undefined;
  return offscreen.toDataURL("image/png");
};
