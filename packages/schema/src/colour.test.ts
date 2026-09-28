import { expect, test } from "vitest";
import { nearestColour, PALETTE_RGB, parseRgbHex, rgbHex, rgbOf } from "./colour";
import { inkFrame } from "./ink";

test("maps rgb to the nearest palette index and back", () => {
  PALETTE_RGB.forEach((rgb, index) => {
    expect(nearestColour(rgb)).toBe(index);
    expect(rgbOf({ colour: index })).toBe(rgb);
  });
  expect(rgbOf({ colour: 2, rgb: 0x123456 })).toBe(0x123456);
  expect(parseRgbHex("#123456")).toBe(0x123456);
  expect(parseRgbHex("abc")).toBe(0xaabbcc);
  expect(parseRgbHex("#12345")).toBeUndefined();
  expect(rgbHex(0x0090ff)).toBe("#0090ff");
});

test("inkFrame accepts rgb and rejects one out of range", () => {
  const frame = {
    strokeId: "stroke-1",
    colour: 0,
    size: "Small",
    nativeZoom: 0,
    from: 0,
    points: [],
  };
  expect(inkFrame.safeParse(frame).success).toBe(true);
  expect(inkFrame.safeParse({ ...frame, rgb: 0x123456 }).success).toBe(true);
  expect(inkFrame.safeParse({ ...frame, rgb: 0x1000000 }).success).toBe(false);
});

test("inkFrame accepts a width from 0.5 to 96 and rejects one outside", () => {
  const frame = {
    strokeId: "stroke-1",
    colour: 0,
    size: "Small",
    nativeZoom: 0,
    from: 0,
    points: [],
  };
  for (const width of [0.5, 1, 60, 96]) {
    expect(inkFrame.safeParse({ ...frame, width }).success).toBe(true);
  }
  for (const width of [0.4, 97, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(inkFrame.safeParse({ ...frame, width }).success).toBe(false);
  }
});
