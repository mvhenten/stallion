import { z } from "zod";
import { colour, nativeZoom, objectId, pencilSize, point, rgb, strokeStyle, width } from "./model";

export const MAX_INK_POINTS = 4096;

export const inkFrame = z.strictObject({
  strokeId: objectId,
  colour,
  rgb: rgb.optional(),
  size: pencilSize,
  width: width.optional(),
  style: strokeStyle,
  nativeZoom,
  from: z.int().min(0).max(MAX_INK_POINTS),
  points: z.array(point).max(MAX_INK_POINTS),
});

export type InkFrame = z.infer<typeof inkFrame>;
