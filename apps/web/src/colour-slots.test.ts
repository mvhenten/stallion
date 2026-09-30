import { PALETTE_RGB } from "@stallion/schema";
import { expect, test } from "vitest";
import {
  CUSTOM_COLOURS_KEY,
  CUSTOM_SLOT_COUNT,
  clearSlot,
  emptySlots,
  loadCustomSlots,
  STANDARD_COLOURS,
  saveCustomSlots,
  stopTracking,
  tapSlot,
  trackColour,
} from "./colour-slots";

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

test("the standard swatches keep the six wire colours first and add cyan, pink, yellow and white", () => {
  expect(STANDARD_COLOURS.slice(0, 6).map(({ rgb }) => rgb)).toEqual([...PALETTE_RGB]);
  expect(STANDARD_COLOURS.slice(6).map(({ name }) => name)).toEqual([
    "Cyan",
    "Pink",
    "Yellow",
    "White",
  ]);
  expect(STANDARD_COLOURS.at(-1)?.rgb).toBe(0xffffff);
});

test("tapping an empty slot fills it with the current colour and tracks every later change", () => {
  const selected = tapSlot(emptySlots(), 2, 0x0090ff);
  expect(selected.pick).toBeUndefined();
  expect(selected.slots.tracking).toBe(2);
  expect(selected.slots.colours[2]).toBe(0x0090ff);
  const mixed = trackColour(trackColour(selected.slots, 0x112233), 0x123456);
  expect(mixed.colours[2]).toBe(0x123456);
  expect(mixed.colours.filter((rgb) => rgb !== undefined)).toEqual([0x123456]);
});

test("without a tracked slot a colour change leaves the slots alone", () => {
  const slots = emptySlots();
  expect(trackColour(slots, 0x123456)).toBe(slots);
});

test("tapping a filled slot picks its colour and stops tracking", () => {
  const first = trackColour(tapSlot(emptySlots(), 0, 1).slots, 0x123456);
  const second = trackColour(tapSlot(first, 1, 0x123456).slots, 0x654321);
  const picked = tapSlot(second, 0, 0x654321);
  expect(picked.pick).toBe(0x123456);
  expect(picked.slots.tracking).toBeUndefined();
  expect(trackColour(picked.slots, 0xabcdef).colours.slice(0, 2)).toEqual([0x123456, 0x654321]);
});

test("clearing a slot empties it and ends tracking when it was the tracked one", () => {
  const tracked = tapSlot(emptySlots(), 3, 0x123456).slots;
  const cleared = clearSlot(tracked, 3);
  expect(cleared.colours[3]).toBeUndefined();
  expect(cleared.tracking).toBeUndefined();
  const other = tapSlot(tapSlot(emptySlots(), 1, 5).slots, 4, 6).slots;
  expect(clearSlot(other, 1).tracking).toBe(4);
  expect(stopTracking(other).tracking).toBeUndefined();
});

test("slots persist per device, drop bad entries and survive blocked storage", () => {
  const store = memoryStore();
  const slots = trackColour(tapSlot(emptySlots(), 5, 1).slots, 0x123456);
  saveCustomSlots(() => store, slots);
  expect(JSON.parse(store.getItem(CUSTOM_COLOURS_KEY) ?? "")).toEqual([
    null,
    null,
    null,
    null,
    null,
    0x123456,
    null,
    null,
  ]);
  const loaded = loadCustomSlots(() => store);
  expect(loaded.colours).toEqual(slots.colours);
  expect(loaded.tracking).toBeUndefined();
  store.setItem(CUSTOM_COLOURS_KEY, '[1, -1, 16777216, "x", 2.5, 7, 8, 9, 10, 11]');
  expect(loadCustomSlots(() => store).colours).toEqual([
    1,
    undefined,
    undefined,
    undefined,
    undefined,
    7,
    8,
    9,
  ]);
  store.setItem(CUSTOM_COLOURS_KEY, "{");
  expect(loadCustomSlots(() => store).colours).toHaveLength(CUSTOM_SLOT_COUNT);
  expect(loadCustomSlots(broken)).toEqual(emptySlots());
  expect(() => saveCustomSlots(broken, slots)).not.toThrow();
});
