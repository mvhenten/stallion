import type { Point } from "@stallion/geometry";

export type PointerKind = "mouse" | "pen" | "touch";

export type Modifiers = { panTool: boolean; spaceDown: boolean };

export type DragInput = {
  first: boolean;
  last: boolean;
  cancelled: boolean;
  intentional: boolean;
  kind: PointerKind;
  button: number;
  point: Point;
  time: number;
};

export type PinchInput = { first: boolean; last: boolean; origin: Point; distance: number };

export type Effect =
  | { type: "StartStroke"; secondary: boolean; point: Point }
  | { type: "ExtendStroke" }
  | { type: "CommitStroke" }
  | { type: "DiscardStroke" }
  | { type: "Pan"; dx: number; dy: number }
  | { type: "Pinch"; anchor: Point; factor: number; dx: number; dy: number };

type DragMode =
  | { mode: "Idle" }
  | { mode: "Ignore" }
  | { mode: "Pending"; point: Point; time: number }
  | { mode: "Draw"; kind: PointerKind }
  | { mode: "Pan"; point: Point };

type PinchMode =
  | { mode: "Idle" }
  | { mode: "Ignore" }
  | { mode: "Track"; start: number; origin: Point; distance: number; zooming: boolean };

export type Input = {
  drag(input: DragInput, modifiers: Modifiers): Effect[];
  pinch(input: PinchInput): Effect[];
  tick(time: number): Effect[];
};

const PRIMARY = 0;
const MIDDLE = 1;
const SECONDARY = 2;

export const PENDING_MS = 60;
export const DRAG_THRESHOLD_PX = 6;
export const PINCH_ZOOM_THRESHOLD = 0.08;

export function createInput(): Input {
  let drag: DragMode = { mode: "Idle" };
  let pinch: PinchMode = { mode: "Idle" };
  let penSeen = false;

  const wantsPan = (input: DragInput, modifiers: Modifiers): boolean => {
    if (input.button === MIDDLE) return true;
    if (input.button !== PRIMARY) return false;
    if (modifiers.panTool || modifiers.spaceDown) return true;
    return input.kind === "touch" && penSeen;
  };

  const promote = (): Effect[] => {
    if (drag.mode !== "Pending") return [];
    const { point } = drag;
    drag = { mode: "Draw", kind: "touch" };
    return [{ type: "StartStroke", secondary: false, point }];
  };

  const begin = (input: DragInput, modifiers: Modifiers): Effect[] => {
    if (input.kind === "pen") penSeen = true;
    if (pinch.mode === "Track") {
      drag = { mode: "Ignore" };
      return [];
    }
    if (wantsPan(input, modifiers)) {
      drag = { mode: "Pan", point: input.point };
      return [];
    }
    if (input.button !== PRIMARY && input.button !== SECONDARY) {
      drag = { mode: "Ignore" };
      return [];
    }
    if (input.kind === "touch") {
      drag = { mode: "Pending", point: input.point, time: input.time };
      return [];
    }
    drag = { mode: "Draw", kind: input.kind };
    return [{ type: "StartStroke", secondary: input.button === SECONDARY, point: input.point }];
  };

  const step = (input: DragInput): Effect[] => {
    const effects: Effect[] = [];
    if (drag.mode === "Pending") {
      if (!input.intentional && input.time - drag.time < PENDING_MS) return [];
      effects.push(...promote());
    }
    if (drag.mode === "Draw") effects.push({ type: "ExtendStroke" });
    if (drag.mode === "Pan") {
      effects.push({
        type: "Pan",
        dx: input.point.x - drag.point.x,
        dy: input.point.y - drag.point.y,
      });
      drag = { mode: "Pan", point: input.point };
    }
    return effects;
  };

  const end = (input: DragInput): Effect[] => {
    const effects: Effect[] = [];
    if (drag.mode === "Pending" && !input.cancelled) effects.push(...promote());
    if (drag.mode === "Draw")
      effects.push({ type: input.cancelled ? "DiscardStroke" : "CommitStroke" });
    drag = { mode: "Idle" };
    return effects;
  };

  const startPinch = (input: PinchInput): Effect[] => {
    if (drag.mode === "Draw" && drag.kind !== "touch") {
      pinch = { mode: "Ignore" };
      return [];
    }
    const discard = drag.mode === "Draw";
    if (drag.mode !== "Idle") drag = { mode: "Ignore" };
    pinch = {
      mode: "Track",
      start: input.distance,
      origin: input.origin,
      distance: input.distance,
      zooming: false,
    };
    return discard ? [{ type: "DiscardStroke" }] : [];
  };

  const movePinch = (input: PinchInput): Effect[] => {
    if (pinch.mode !== "Track") return [];
    const { origin, distance } = input;
    const spread = pinch.start > 0 ? Math.abs(distance / pinch.start - 1) : 0;
    const zooming = pinch.zooming || spread > PINCH_ZOOM_THRESHOLD;
    const factor =
      pinch.zooming && pinch.distance > 0 && distance > 0 ? distance / pinch.distance : 1;
    const effect: Effect = {
      type: "Pinch",
      anchor: pinch.origin,
      factor,
      dx: origin.x - pinch.origin.x,
      dy: origin.y - pinch.origin.y,
    };
    pinch = { ...pinch, origin, distance, zooming };
    return [effect];
  };

  return {
    drag(input, modifiers) {
      if (input.first) {
        const effects = begin(input, modifiers);
        return input.last ? [...effects, ...end(input)] : effects;
      }
      return input.last ? end(input) : step(input);
    },
    pinch(input) {
      if (input.first) return startPinch(input);
      if (!input.last) return movePinch(input);
      pinch = { mode: "Idle" };
      return [];
    },
    tick(time) {
      return drag.mode === "Pending" && time - drag.time >= PENDING_MS ? promote() : [];
    },
  };
}
