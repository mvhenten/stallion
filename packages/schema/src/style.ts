export const STROKE_STYLES = ["Pen", "Highlighter", "Dashed", "Uniform"] as const;

export type StrokeStyle = (typeof STROKE_STYLES)[number];

export const DEFAULT_STROKE_STYLE: StrokeStyle = "Pen";

export type Styled = { style?: StrokeStyle | undefined };

export const styleOf = ({ style }: Styled): StrokeStyle => style ?? DEFAULT_STROKE_STYLE;

export const withStyle = <T extends Styled>(object: T): T & { style: StrokeStyle } => ({
  ...object,
  style: styleOf(object),
});
