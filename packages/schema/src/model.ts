import { z } from "zod";
import { DEFAULT_OPACITY, SHAPE_FILLS, SHAPE_KINDS } from "./shape";
import { MAX_STICKY_BYTES, MAX_WRAP_WIDTH } from "./sticky";
import { DEFAULT_STROKE_STYLE, STROKE_STYLES } from "./style";
import {
  DEFAULT_TEXT_FIT,
  DEFAULT_TEXT_FONT,
  HREF_PATTERN,
  MAX_HREF_BYTES,
  TEXT_FITS,
  TEXT_FONTS,
} from "./text-style";
import { MAX_WIDTH, MIN_WIDTH } from "./width";

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

export const width = z.number().min(MIN_WIDTH).max(MAX_WIDTH);

export const strokeStyle = z.enum(STROKE_STYLES).default(DEFAULT_STROKE_STYLE);

export const pencilSize = z.enum(["Small", "Medium", "Large"]);

export const point = z.tuple([z.number(), z.number(), z.number().min(0).max(1)]);

export const shapePoint = z.tuple([z.number(), z.number()]);

export const textFont = z.enum(TEXT_FONTS).default(DEFAULT_TEXT_FONT);

export const textFit = z.enum(TEXT_FITS).default(DEFAULT_TEXT_FIT);

export const href = z.string().max(MAX_HREF_BYTES).regex(new RegExp(HREF_PATTERN));

const textStyle = {
  font: textFont,
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  href: href.optional(),
  fit: textFit,
};

export const stroke = z.strictObject({
  type: z.literal("Stroke"),
  objectId,
  nativeZoom,
  bbox,
  colour,
  rgb: rgb.optional(),
  size: pencilSize,
  width: width.optional(),
  style: strokeStyle,
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
  width: width.optional(),
  style: strokeStyle,
  kind: z.enum(SHAPE_KINDS),
  start: shapePoint,
  end: shapePoint,
  fill: z.enum(SHAPE_FILLS),
  fillRgb: rgb.optional(),
  outline: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(DEFAULT_OPACITY),
});

export const text = z.strictObject({
  type: z.literal("Text"),
  objectId,
  nativeZoom,
  bbox,
  rgb,
  width,
  wrapWidth: z.number().gt(0).max(MAX_WRAP_WIDTH),
  text: z.string().min(1).max(MAX_STICKY_BYTES),
  ...textStyle,
});

export const sticky = z.strictObject({
  type: z.literal("Sticky"),
  objectId,
  nativeZoom,
  bbox,
  rgb,
  background: rgb,
  width,
  text: z.string().max(MAX_STICKY_BYTES),
  ...textStyle,
});

export const stallionObject = z.discriminatedUnion("type", [stroke, shape, text, sticky]);

export type Bbox = z.infer<typeof bbox>;
export type Point = z.infer<typeof point>;
export type ShapePoint = z.infer<typeof shapePoint>;
export type PencilSize = z.infer<typeof pencilSize>;
export type Stroke = z.infer<typeof stroke>;
export type Shape = z.infer<typeof shape>;
export type Text = z.infer<typeof text>;
export type Sticky = z.infer<typeof sticky>;
export type StallionObject = z.infer<typeof stallionObject>;
