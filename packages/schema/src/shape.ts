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
