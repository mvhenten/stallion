import { PALETTE_RGB } from "@stallion/schema";

export const STANDARD_COLOURS: readonly { rgb: number; name: string }[] = [
  { rgb: PALETTE_RGB[0], name: "Black" },
  { rgb: PALETTE_RGB[1], name: "Red" },
  { rgb: PALETTE_RGB[2], name: "Orange" },
  { rgb: PALETTE_RGB[3], name: "Green" },
  { rgb: PALETTE_RGB[4], name: "Blue" },
  { rgb: PALETTE_RGB[5], name: "Purple" },
  { rgb: 0x00a2c7, name: "Cyan" },
  { rgb: 0xd6409f, name: "Pink" },
  { rgb: 0xf5d90a, name: "Yellow" },
  { rgb: 0xffffff, name: "White" },
];

export const CUSTOM_COLOURS_KEY = "stallion:custom-colours";

export const CUSTOM_SLOT_COUNT = 8;

export type CustomSlots = {
  colours: readonly (number | undefined)[];
  tracking: number | undefined;
};

export type SlotTap = { slots: CustomSlots; pick: number | undefined };

export const emptySlots = (): CustomSlots => ({
  colours: Array.from({ length: CUSTOM_SLOT_COUNT }, () => undefined),
  tracking: undefined,
});

const withColour = (
  colours: readonly (number | undefined)[],
  index: number,
  rgb: number | undefined,
): (number | undefined)[] => colours.map((entry, at) => (at === index ? rgb : entry));

export const tapSlot = (slots: CustomSlots, index: number, current: number): SlotTap => {
  const stored = slots.colours[index];
  if (stored === undefined) {
    return {
      slots: { colours: withColour(slots.colours, index, current), tracking: index },
      pick: undefined,
    };
  }
  return { slots: { ...slots, tracking: undefined }, pick: stored };
};

export const trackColour = (slots: CustomSlots, rgb: number): CustomSlots => {
  if (slots.tracking === undefined || slots.colours[slots.tracking] === rgb) return slots;
  return { ...slots, colours: withColour(slots.colours, slots.tracking, rgb) };
};

export const clearSlot = (slots: CustomSlots, index: number): CustomSlots => ({
  colours: withColour(slots.colours, index, undefined),
  tracking: slots.tracking === index ? undefined : slots.tracking,
});

export const stopTracking = (slots: CustomSlots): CustomSlots =>
  slots.tracking === undefined ? slots : { ...slots, tracking: undefined };

type Store = Pick<Storage, "getItem" | "setItem">;

const isRgb = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff;

export const loadCustomSlots = (store: () => Store): CustomSlots => {
  try {
    const parsed: unknown = JSON.parse(store().getItem(CUSTOM_COLOURS_KEY) ?? "[]");
    const stored: unknown[] = Array.isArray(parsed) ? parsed : [];
    return {
      colours: Array.from({ length: CUSTOM_SLOT_COUNT }, (_, index) => {
        const entry = stored[index];
        return isRgb(entry) ? entry : undefined;
      }),
      tracking: undefined,
    };
  } catch {
    return emptySlots();
  }
};

export const saveCustomSlots = (store: () => Store, slots: CustomSlots): void => {
  try {
    store().setItem(
      CUSTOM_COLOURS_KEY,
      JSON.stringify(slots.colours.map((entry) => entry ?? null)),
    );
  } catch {
    return;
  }
};

export type Rect = { left: number; top: number; right: number; bottom: number };

export type PopoverSpot = { left: number; top: number; maxHeight: number };

export const POPOVER_GAP = 10;
export const POPOVER_GUTTER = 16;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

export const placeColourPopover = (
  anchor: Rect,
  bar: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  beside: boolean,
): PopoverSpot => {
  const fullHeight = viewport.height - 2 * POPOVER_GUTTER;
  const maxLeft = viewport.width - POPOVER_GUTTER - size.width;
  if (beside) {
    const height = Math.min(size.height, fullHeight);
    return {
      left: Math.max(POPOVER_GUTTER, Math.min(bar.right + POPOVER_GAP, maxLeft)),
      top: clamp(anchor.top, POPOVER_GUTTER, viewport.height - POPOVER_GUTTER - height),
      maxHeight: Math.floor(height),
    };
  }
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.max(POPOVER_GUTTER, Math.min(centre - size.width / 2, maxLeft));
  const below = viewport.height - bar.bottom - POPOVER_GAP - POPOVER_GUTTER;
  const above = bar.top - POPOVER_GAP - POPOVER_GUTTER;
  if (below >= size.height || below >= above) {
    return {
      left,
      top: bar.bottom + POPOVER_GAP,
      maxHeight: Math.floor(Math.min(size.height, below)),
    };
  }
  const height = Math.min(size.height, above);
  return { left, top: bar.top - POPOVER_GAP - height, maxHeight: Math.floor(height) };
};
