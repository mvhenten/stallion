import { MAX_WIDTH, MIN_WIDTH, type TextFont, type TextStyle } from "@stallion/schema";
import { strokeWorldWidth } from "./stroke";

export const FONT_STACKS: Readonly<Record<TextFont, string>> = {
  Sans: "system-ui, Helvetica, Arial, sans-serif",
  Serif: 'Georgia, "Times New Roman", Times, serif',
  Mono: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  Hand: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", "Segoe Print", cursive',
};

export type Face = Pick<TextStyle, "font" | "bold" | "italic">;

export const PLAIN_FACE: Face = { font: "Sans", bold: false, italic: false };

export const LINE_HEIGHT = 1.3;

export const MIN_TEXT_PX = 1.5;

const MEASURE_PX = 100;

export type Measure = (text: string) => number;

export type MeasureAt = (px: number, face: Face) => Measure;

export const canvasFont = (px: number, face: Face = PLAIN_FACE): string =>
  `${face.italic ? "italic " : ""}${face.bold ? "bold " : ""}${px}px ${FONT_STACKS[face.font]}`;

export const measureText =
  (ctx: CanvasRenderingContext2D, px: number, face: Face): Measure =>
  (text) => {
    ctx.font = canvasFont(px, face);
    return ctx.measureText(text).width;
  };

export const faceOf = ({ font, bold, italic }: Face): Face => ({ font, bold, italic });

export const measureIn =
  (measureAt: MeasureAt, face: Face): ((px: number) => Measure) =>
  (px) =>
    measureAt(px, face);

const breakWord = (word: string, maxWidth: number, measure: Measure): string[] => {
  const pieces: string[] = [];
  let piece = "";
  for (const char of word) {
    if (piece !== "" && measure(piece + char) > maxWidth) {
      pieces.push(piece);
      piece = char;
      continue;
    }
    piece += char;
  }
  if (piece !== "") pieces.push(piece);
  return pieces;
};

export const wrapText = (text: string, maxWidth: number, measure: Measure): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\s*\S+\s*|\s+/g) ?? []) {
      if (measure((line + token).trimEnd()) <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trimEnd() !== "") lines.push(line.trimEnd());
      line = "";
      const pieces = breakWord(token.trimEnd(), maxWidth, measure);
      const last = pieces.pop() ?? "";
      lines.push(...pieces);
      line = last + token.slice(token.trimEnd().length);
    }
    lines.push(line.trimEnd());
  }
  return lines;
};

export const wrapWorld = (
  text: string,
  width: number,
  font: number,
  measureAt: (px: number) => Measure,
): string[] => wrapText(text, (width / font) * MEASURE_PX, measureAt(MEASURE_PX));

export const widestWorld = (
  lines: readonly string[],
  font: number,
  measureAt: (px: number) => Measure,
): number => {
  const measure = measureAt(MEASURE_PX);
  return Math.max(0, ...lines.map((line) => (measure(line) / MEASURE_PX) * font));
};

export const worldFont = (object: { width: number; nativeZoom: number }): number =>
  strokeWorldWidth(object.width, object.nativeZoom);

export const clampFont = (width: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));

export const fontForScreen = (px: number, nativeZoom: number, zoom: number): number =>
  clampFont(px / strokeWorldWidth(1, nativeZoom) / zoom);

export const UNDERLINE_EM = 0.55;

export const paintLines = (
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  origin: { x: number; y: number },
  px: number,
  colour: string,
  face: Face = PLAIN_FACE,
  underline = false,
): void => {
  if (px < MIN_TEXT_PX) return;
  ctx.fillStyle = colour;
  ctx.font = canvasFont(px, face);
  ctx.textBaseline = "middle";
  const thickness = Math.max(1, px / 14);
  lines.forEach((line, index) => {
    const middle = origin.y + (index + 0.5) * LINE_HEIGHT * px;
    ctx.fillText(line, origin.x, middle);
    if (underline && line !== "") {
      ctx.fillRect(
        origin.x,
        middle + px * UNDERLINE_EM - thickness,
        ctx.measureText(line).width,
        thickness,
      );
    }
  });
};
