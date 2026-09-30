import { expect, test } from "vitest";
import {
  expandedAfterPick,
  loadMode,
  loadStyle,
  MODE_KEY,
  placePopover,
  STYLE_KEY,
  saveMode,
  saveStyle,
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
    ["Wheel", "Pencil", "Eraser", "Undo", "Level", "Connection", "Expand"],
  ]);
});

test("the expanded bar adds sizes, all ten colours, the custom slots, the other tools and the flip", () => {
  const rows = toolbarRows(toolbarLayout("Quick", false, true));
  expect(rows.length).toBeLessThanOrEqual(5);
  expect(rows).toContainEqual(["Colours"]);
  expect(rows).toContainEqual(["CustomSlots"]);
  expect(rows.flat()).not.toContain("BaseColours");
  expect(rows.flat()).toEqual(
    expect.arrayContaining([
      "Sizes",
      "Wheel",
      "Pan",
      "Select",
      "Redo",
      "Share",
      "Swap",
      "Shapes",
      "Flip",
    ]),
  );
});

test("only the palette carries the hex field and the quick bars never show the custom slots", () => {
  for (const layout of ["Wide", "Collapsed"] as const) {
    expect(toolbarRows(layout).flat()).not.toContain("CustomSlots");
  }
  for (const layout of ["Wide", "Collapsed", "Expanded"] as const) {
    expect(toolbarRows(layout).flat()).not.toContain("Hex");
  }
});

test("a wide screen shows every tool, the shapes and the flip on one row without a toggle", () => {
  expect(toolbarRows(toolbarLayout("Quick", true, false))).toEqual([
    [
      "Sizes",
      "BaseColours",
      "Wheel",
      "Swap",
      "Pan",
      "Select",
      "Shapes",
      "Sticky",
      "Text",
      "Eraser",
      "Undo",
      "Redo",
      "Share",
      "Level",
      "Connection",
      "Flip",
    ],
  ]);
});

test("the palette holds every tool and the flip back, on any screen, without a toggle", () => {
  for (const wide of [false, true]) {
    for (const expanded of [false, true]) {
      const controls = toolbarRows(toolbarLayout("Palette", wide, expanded)).flat();
      expect(controls).toEqual(
        expect.arrayContaining([
          "Flip",
          "Sizes",
          "Width",
          "Styles",
          "Shapes",
          "Colours",
          "CustomSlots",
          "Wheel",
          "Hex",
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
      expect(controls).not.toContain("BaseColours");
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

test("the stroke style round-trips through storage and defaults to Pen", () => {
  const store = memoryStore();
  expect(loadStyle(() => store)).toBe("Pen");
  saveStyle(() => store, "Highlighter");
  expect(store.getItem(STYLE_KEY)).toBe("Highlighter");
  expect(loadStyle(() => store)).toBe("Highlighter");
  store.setItem(STYLE_KEY, "Marker");
  expect(loadStyle(() => store)).toBe("Pen");
  expect(loadStyle(broken)).toBe("Pen");
  expect(() => saveStyle(broken, "Dashed")).not.toThrow();
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
