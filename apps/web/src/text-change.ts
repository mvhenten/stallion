import type { Sticky, Text, TextFit, TextFont } from "@stallion/schema";
import { clampFont } from "./wrap";

export type TextChange =
  | { font: TextFont }
  | { bold: boolean }
  | { italic: boolean }
  | { fit: TextFit }
  | { href: string | undefined }
  | { fontScale: number };

export const FONT_STEP = 1.25;

export function applyTextChange(object: Sticky, change: TextChange): Sticky;
export function applyTextChange(object: Text, change: TextChange): Text;
export function applyTextChange(object: Sticky | Text, change: TextChange): Sticky | Text {
  if ("fontScale" in change) {
    return { ...object, width: clampFont(object.width * change.fontScale), fit: "Fixed" };
  }
  if ("href" in change) {
    const { href: _previous, ...unlinked } = object;
    return change.href === undefined ? unlinked : { ...unlinked, href: change.href };
  }
  return { ...object, ...change };
}
