import { expect, test } from "vitest";
import { wrapText } from "./wrap";

const chars = (text: string): number => text.length;

test("keeps a line that fits whole", () => {
  expect(wrapText("buy milk", 10, chars)).toEqual(["buy milk"]);
});

test("breaks between words at the width", () => {
  expect(wrapText("buy milk and eggs today", 10, chars)).toEqual(["buy milk", "and eggs", "today"]);
});

test("keeps typed line breaks and blank lines", () => {
  expect(wrapText("one\n\ntwo", 10, chars)).toEqual(["one", "", "two"]);
  expect(wrapText("", 10, chars)).toEqual([""]);
});

test("breaks a word longer than the width by characters", () => {
  expect(wrapText("ab supercalifragilistic cd", 8, chars)).toEqual([
    "ab",
    "supercal",
    "ifragili",
    "stic cd",
  ]);
});
