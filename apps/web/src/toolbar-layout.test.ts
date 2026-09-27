import { expect, test } from "vitest";
import {
  expandedAfterPick,
  loadMode,
  MODE_KEY,
  placePopover,
  saveMode,
  toolbarLayout,
  toolbarRows,
} from "./toolbar-layout";

const memoryStore = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

const broken = () => {
  throw new Error("storage blocked");
};

test("the collapsed bar is one row of the everyday controls and the toggle", () => {
  expect(toolbarRows(toolbarLayout("Quick", false, false))).toEqual([
    ["CurrentColour", "Pencil", "Eraser", "Undo", "Level", "Connection", "Expand"],
  ]);
});

test("the expanded bar adds sizes, colours, the other tools and the palette flip", () => {
  const rows = toolbarRows(toolbarLayout("Quick", false, true));
  expect(rows.length).toBeLessThanOrEqual(4);
  expect(rows.flat()).toEqual(
    expect.arrayContaining(["Sizes", "Colours", "Pan", "Select", "Redo", "Share", "Swap", "Flip"]),
  );
});

test("a wide screen shows every tool and the flip on one row without a toggle", () => {
  const rows = toolbarRows(toolbarLayout("Quick", true, false));
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toContain("Expand");
  expect(rows[0]).toEqual(expect.arrayContaining(["Sizes", "Colours", "Redo", "Share", "Flip"]));
});

test("the palette holds every tool and the flip back, on any screen, without a toggle", () => {
  for (const wide of [false, true]) {
    for (const expanded of [false, true]) {
      const controls = toolbarRows(toolbarLayout("Palette", wide, expanded)).flat();
      expect(controls).toEqual(
        expect.arrayContaining([
          "Flip",
          "Sizes",
          "Colours",
          "Swap",
          "Pan",
          "Select",
          "Eraser",
          "Undo",
          "Redo",
          "Level",
          "Share",
          "Connection",
        ]),
      );
      expect(controls).not.toContain("Expand");
    }
  }
});

test("the toolbar mode round-trips through storage and defaults to the quick bar", () => {
  const store = memoryStore();
  expect(loadMode(() => store)).toBe("Quick");
  saveMode(() => store, "Palette");
  expect(store.getItem(MODE_KEY)).toBe("Palette");
  expect(loadMode(() => store)).toBe("Palette");
  saveMode(() => store, "Quick");
  expect(loadMode(() => store)).toBe("Quick");
  store.setItem(MODE_KEY, "Sideways");
  expect(loadMode(() => store)).toBe("Quick");
});

test("blocked storage falls back to the quick bar and saving does not throw", () => {
  expect(loadMode(broken)).toBe("Quick");
  expect(() => saveMode(broken, "Palette")).not.toThrow();
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
