import type { PencilSize } from "./model";

export const MIN_WIDTH = 0.5;

export const MAX_WIDTH = 96;

export const PENCIL_PX: Readonly<Record<PencilSize, number>> = { Small: 3, Medium: 8, Large: 20 };

export type Sized = { size: PencilSize; width?: number | undefined };

export const widthOf = ({ size, width }: Sized): number => width ?? PENCIL_PX[size];

// Sizes are spaced by ratio, so the nearest one is judged on a log scale.
export const nearestSize = (width: number): PencilSize => {
  let best: PencilSize = "Medium";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [size, px] of Object.entries(PENCIL_PX) as [PencilSize, number][]) {
    const distance = Math.abs(Math.log(width / px));
    if (distance < bestDistance) {
      best = size;
      bestDistance = distance;
    }
  }
  return best;
};

export const withWidth = <T extends Sized>(object: T): T & { width: number } => ({
  ...object,
  width: widthOf(object),
});
