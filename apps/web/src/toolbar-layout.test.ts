import { expect, test } from "vitest";
import { expandedAfterPick, placePopover, toolbarLayout, toolbarRows } from "./toolbar-layout";

test("the collapsed bar is one row of the everyday controls and the toggle", () => {
  expect(toolbarRows(toolbarLayout(false, false))).toEqual([
    ["CurrentColour", "Pencil", "Eraser", "Undo", "Level", "Connection", "Expand"],
  ]);
});

test("the expanded bar adds sizes, colours and the other tools in at most three rows", () => {
  const rows = toolbarRows(toolbarLayout(false, true));
  expect(rows.length).toBeLessThanOrEqual(3);
  expect(rows.flat()).toEqual(
    expect.arrayContaining(["Sizes", "Colours", "Pan", "Select", "Redo", "Share", "Swap"]),
  );
});

test("a wide screen shows every tool on one row without a toggle", () => {
  const rows = toolbarRows(toolbarLayout(true, false));
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toContain("Expand");
  expect(rows[0]).toEqual(expect.arrayContaining(["Sizes", "Colours", "Redo", "Share"]));
});

test("picking a colour collapses the bar on a narrow screen and not on a wide one", () => {
  expect(expandedAfterPick(false, true)).toBe(false);
  expect(expandedAfterPick(true, true)).toBe(true);
});

test("a popover flips above its anchor when there is no room below", () => {
  expect(placePopover({ top: 12, bottom: 68 }, 844, 440)).toEqual({
    side: "Below",
    maxHeight: 440,
  });
  expect(placePopover({ top: 780, bottom: 820 }, 844, 440)).toEqual({
    side: "Above",
    maxHeight: 440,
  });
  expect(placePopover({ top: 300, bottom: 344 }, 500, 440)).toEqual({
    side: "Above",
    maxHeight: 274,
  });
});
