export const WIDE_QUERY = "(min-width: 960px)";

export const EXPANDED_KEY = "stallion:toolbar-expanded";

export const MODE_KEY = "stallion:toolbar-mode";

export type ToolbarMode = "Quick" | "Palette";

export type Control =
  | "Sizes"
  | "Colours"
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
