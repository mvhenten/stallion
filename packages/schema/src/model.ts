import { z } from "zod";

export const objectId = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);

export const nativeZoom = z.int().min(-40).max(40);

export const bbox = z.strictObject({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export const colour = z.int().min(0).max(5);

export const rgb = z.int().min(0).max(0xffffff);

export const pencilSize = z.enum(["Small", "Medium", "Large"]);

export const point = z.tuple([z.number(), z.number(), z.number().min(0).max(1)]);

export const stroke = z.strictObject({
  type: z.literal("Stroke"),
  objectId,
  nativeZoom,
  bbox,
  colour,
  rgb: rgb.optional(),
  size: pencilSize,
  points: z.array(point).min(1).max(4096),
});

export const shape = z.strictObject({
  type: z.literal("Shape"),
  objectId,
  nativeZoom,
  bbox,
  colour,
  rgb: rgb.optional(),
  size: pencilSize,
  shape: z.enum(["Rectangle", "Ellipse", "Line"]),
});

export const text = z.strictObject({
  type: z.literal("Text"),
  objectId,
  nativeZoom,
  bbox,
  colour,
  rgb: rgb.optional(),
  size: pencilSize,
  text: z.string().min(1).max(4096),
});

export const stallionObject = z.discriminatedUnion("type", [stroke, shape, text]);

export type Bbox = z.infer<typeof bbox>;
export type Point = z.infer<typeof point>;
export type PencilSize = z.infer<typeof pencilSize>;
export type Stroke = z.infer<typeof stroke>;
export type Shape = z.infer<typeof shape>;
export type Text = z.infer<typeof text>;
export type StallionObject = z.infer<typeof stallionObject>;
