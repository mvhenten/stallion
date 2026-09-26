import { z } from "zod";
import { colour, nativeZoom, objectId, pencilSize, point } from "./model";

export const MAX_INK_POINTS = 4096;

export const inkFrame = z.strictObject({
  strokeId: objectId,
  colour,
  size: pencilSize,
  nativeZoom,
  from: z.int().min(0).max(MAX_INK_POINTS),
  points: z.array(point).max(MAX_INK_POINTS),
});

export type InkFrame = z.infer<typeof inkFrame>;
