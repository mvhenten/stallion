export const SHAPE_KINDS = ["Rectangle", "Ellipse", "Line", "Arrow"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_FILLS = ["None", "Tint"] as const;

export type ShapeFill = (typeof SHAPE_FILLS)[number];

export const FILLABLE: Readonly<Record<ShapeKind, boolean>> = {
  Rectangle: true,
  Ellipse: true,
  Line: false,
  Arrow: false,
};

export const DEFAULT_OPACITY = 1;

export type ShapePaint = { outline: boolean; opacity: number };

export type ShapePaintable = { outline?: boolean | undefined; opacity?: number | undefined };

export const shapePaintOf = (shape: ShapePaintable): ShapePaint => ({
  outline: shape.outline ?? true,
  opacity: shape.opacity ?? DEFAULT_OPACITY,
});

export const withShapePaint = <T extends ShapePaintable>(shape: T): T & ShapePaint => ({
  ...shape,
  ...shapePaintOf(shape),
});
