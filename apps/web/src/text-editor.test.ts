import { expect, test } from "vitest";
import { freeBand, revealShift } from "./text-editor";

const phone = { top: 12, bottom: 903 };
const toolbar = { left: 49, right: 797, top: 12, bottom: 66 };
const presence = { left: 760, right: 843, top: 840, bottom: 903 };

test("an editor under the toolbar pans down into the free band below it", () => {
  const editor = { left: 211, right: 611, top: 26, bottom: 286 };
  const band = freeBand(editor, phone, [toolbar, presence]);
  expect(band).toEqual({ top: 78, bottom: 903 });
  expect(revealShift(editor.top, editor.bottom - editor.top, band)).toBe(52);
});

test("an editor over the presence floater pans up, never above the toolbar", () => {
  const editor = { left: 600, right: 840, top: 700, bottom: 900 };
  const band = freeBand(editor, phone, [toolbar, presence]);
  expect(band).toEqual({ top: 12, bottom: 828 });
  expect(revealShift(editor.top, 200, band)).toBe(-72);
});

test("a tall editor under the toolbar keeps Done above the keyboard", () => {
  const keyboard = { top: 12, bottom: 400 };
  const editor = { left: 211, right: 611, top: 26, bottom: 386 };
  const band = freeBand(editor, keyboard, [toolbar]);
  expect(revealShift(editor.top, 360, band)).toBe(14);
});

test("an editor clear of every overlay stays put", () => {
  const editor = { left: 211, right: 611, top: 200, bottom: 460 };
  expect(revealShift(200, 260, freeBand(editor, phone, [toolbar, presence]))).toBe(0);
});
