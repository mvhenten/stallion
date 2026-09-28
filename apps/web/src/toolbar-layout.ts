export const WIDE_QUERY = "(min-width: 960px)";

export const EXPANDED_KEY = "stallion:toolbar-expanded";

export const MODE_KEY = "stallion:toolbar-mode";

export const RECENT_COLOURS_KEY = "stallion:recent-colours";

export const MAX_RECENT_COLOURS = 8;

export type ToolbarMode = "Quick" | "Palette";

export type Control =
  | "Sizes"
  | "Colours"
  | "CustomColour"
  | "RecentColours"
  | "CurrentColour"
  | "Pencil"
  | "Pan"
  | "Select"
  | "Eraser"
  | "Swap"
  | "Undo"
  | "Redo"
  | "Share"
  | "Level"
  | "Connection"
  | "Expand"
  | "Flip";

export type ToolbarLayout = "Wide" | "Collapsed" | "Expanded" | "Palette";

const WIDE_ROW: readonly Control[] = [
  "Sizes",
  "Colours",
  "Pan",
  "Select",
  "Eraser",
  "Swap",
  "Undo",
  "Redo",
  "Share",
  "Level",
  "Connection",
  "Flip",
];

const COLLAPSED_ROW: readonly Control[] = [
  "CurrentColour",
  "Pencil",
  "Eraser",
  "Undo",
  "Level",
  "Connection",
  "Expand",
];

const EXPANDED_ROWS: readonly (readonly Control[])[] = [
  COLLAPSED_ROW,
  ["Sizes", "Pan", "Select", "Redo", "Share"],
  ["Colours", "Swap"],
  ["Flip"],
];

const PALETTE_ROWS: readonly (readonly Control[])[] = [
  ["Flip", "Connection"],
  ["Sizes"],
  ["Colours"],
  ["CustomColour", "RecentColours"],
  ["Swap", "Pan", "Select", "Eraser"],
  ["Undo", "Redo"],
  ["Level", "Share"],
];

export const toolbarLayout = (
  mode: ToolbarMode,
  wide: boolean,
  expanded: boolean,
): ToolbarLayout => {
  if (mode === "Palette") return "Palette";
  if (wide) return "Wide";
  return expanded ? "Expanded" : "Collapsed";
};

export const toolbarRows = (layout: ToolbarLayout): readonly (readonly Control[])[] => {
  if (layout === "Wide") return [WIDE_ROW];
  if (layout === "Collapsed") return [COLLAPSED_ROW];
  if (layout === "Palette") return PALETTE_ROWS;
  return EXPANDED_ROWS;
};

export const expandedAfterPick = (wide: boolean, expanded: boolean): boolean =>
  wide ? expanded : false;

type Store = Pick<Storage, "getItem" | "setItem">;

export const loadExpanded = (store: () => Store): boolean => {
  try {
    return store().getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
};

export const saveExpanded = (store: () => Store, expanded: boolean): void => {
  try {
    store().setItem(EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    return;
  }
};

export const loadMode = (store: () => Store): ToolbarMode => {
  try {
    return store().getItem(MODE_KEY) === "Palette" ? "Palette" : "Quick";
  } catch {
    return "Quick";
  }
};

export const saveMode = (store: () => Store, mode: ToolbarMode): void => {
  try {
    store().setItem(MODE_KEY, mode);
  } catch {
    return;
  }
};

const isRgb = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffff;

export const loadRecentColours = (store: () => Store): number[] => {
  try {
    const parsed: unknown = JSON.parse(store().getItem(RECENT_COLOURS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRgb).slice(0, MAX_RECENT_COLOURS) : [];
  } catch {
    return [];
  }
};

export const withRecentColour = (recents: readonly number[], rgb: number): number[] =>
  [rgb, ...recents.filter((entry) => entry !== rgb)].slice(0, MAX_RECENT_COLOURS);

export const saveRecentColours = (store: () => Store, recents: readonly number[]): void => {
  try {
    store().setItem(RECENT_COLOURS_KEY, JSON.stringify(recents));
  } catch {
    return;
  }
};

export type Placement = { side: "Below" | "Above"; maxHeight: number };

export const POPOVER_GAP = 10;
export const VIEWPORT_GUTTER = 16;

export const placePopover = (
  anchor: { top: number; bottom: number },
  viewportHeight: number,
  desiredHeight: number,
): Placement => {
  const below = viewportHeight - anchor.bottom - POPOVER_GAP - VIEWPORT_GUTTER;
  const above = anchor.top - POPOVER_GAP - VIEWPORT_GUTTER;
  const side = below >= desiredHeight || below >= above ? "Below" : "Above";
  const room = side === "Below" ? below : above;
  return { side, maxHeight: Math.max(0, Math.floor(Math.min(desiredHeight, room))) };
};
