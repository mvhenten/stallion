import { expect, test } from "vitest";
import { CONTEXT_GAP_PX, CONTEXT_GUTTER_PX, placeContextToolbar } from "./text-toolbar";

const phone = { left: 0, top: 0, right: 390, bottom: 844 };
const size = { width: 320, height: 44 };
const mainToolbar = { left: 16, top: 12, right: 374, bottom: 66 };

test("the text toolbar sits centred above the object when there is room", () => {
  const anchor = { left: 100, top: 300, right: 300, bottom: 500 };
  expect(placeContextToolbar(anchor, size, phone, [mainToolbar])).toEqual({
    left: 40,
    top: 300 - CONTEXT_GAP_PX - 44,
    side: "Above",
  });
});

test("it drops below an object that would push it under the main toolbar", () => {
  const anchor = { left: 0, top: 90, right: 200, bottom: 290 };
  expect(placeContextToolbar(anchor, size, phone, [mainToolbar])).toEqual({
    left: CONTEXT_GUTTER_PX,
    top: 290 + CONTEXT_GAP_PX,
    side: "Below",
  });
});

test("an object filling the screen keeps the toolbar inside it, under the main toolbar", () => {
  const anchor = { left: -50, top: -50, right: 900, bottom: 1200 };
  const keyboardUp = { ...phone, bottom: 500 };
  expect(placeContextToolbar(anchor, size, keyboardUp, [mainToolbar])).toEqual({
    left: 35,
    top: 66 + CONTEXT_GAP_PX,
    side: "Inside",
  });
});
