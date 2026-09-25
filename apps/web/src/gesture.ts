import type { Point } from "@stallion/geometry";

export type PointerKind = "mouse" | "pen" | "touch";

export type PointerDown = {
  pointerId: number;
  kind: PointerKind;
  button: number;
  point: Point;
};

export type Modifiers = { panTool: boolean; spaceDown: boolean };

export type Effect =
  | { type: "StartStroke"; secondary: boolean }
  | { type: "ExtendStroke" }
  | { type: "CommitStroke" }
  | { type: "DiscardStroke" }
  | { type: "Pan"; dx: number; dy: number }
  | { type: "Pinch"; from: readonly [Point, Point]; to: readonly [Point, Point] };

type Tracked = { point: Point; kind: PointerKind };

type State =
  | { mode: "Idle" }
  | { mode: "Draw"; pointerId: number }
  | { mode: "Pan"; pointerId: number }
  | { mode: "Pinch" };

export type Gestures = {
  down(event: PointerDown, modifiers: Modifiers): Effect[];
  move(pointerId: number, point: Point): Effect[];
  up(pointerId: number): Effect[];
  cancel(pointerId: number): Effect[];
};

const PRIMARY = 0;
const MIDDLE = 1;
const SECONDARY = 2;

export function createGestures(): Gestures {
  const pointers = new Map<number, Tracked>();
  let state: State = { mode: "Idle" };
  let penSeen = false;

  const touchIds = (): number[] =>
    [...pointers.entries()].filter(([, tracked]) => tracked.kind === "touch").map(([id]) => id);

  const wantsPan = (event: PointerDown, modifiers: Modifiers): boolean => {
    if (event.button === MIDDLE) return true;
    if (event.button !== PRIMARY) return false;
    if (modifiers.panTool || modifiers.spaceDown) return true;
    return event.kind === "touch" && penSeen;
  };

  const down = (event: PointerDown, modifiers: Modifiers): Effect[] => {
    pointers.set(event.pointerId, { point: event.point, kind: event.kind });
    if (event.kind === "pen") penSeen = true;

    if (event.kind === "touch" && touchIds().length >= 2) {
      const discard = state.mode === "Draw" && pointers.get(state.pointerId)?.kind === "touch";
      if (state.mode === "Draw" && !discard) return [];
      state = { mode: "Pinch" };
      return discard ? [{ type: "DiscardStroke" }] : [];
    }

    if (state.mode !== "Idle") return [];
    if (wantsPan(event, modifiers)) {
      state = { mode: "Pan", pointerId: event.pointerId };
      return [];
    }
    if (event.button !== PRIMARY && event.button !== SECONDARY) return [];
    state = { mode: "Draw", pointerId: event.pointerId };
    return [{ type: "StartStroke", secondary: event.button === SECONDARY }];
  };

  const pinchEffect = (pointerId: number, point: Point): Effect[] => {
    const [first, second] = touchIds();
    if (first === undefined) return [];
    if (second === undefined) {
      const previous = pointers.get(first)?.point;
      if (first !== pointerId || !previous) return [];
      return [{ type: "Pan", dx: point.x - previous.x, dy: point.y - previous.y }];
    }
    if (pointerId !== first && pointerId !== second) return [];
    const a = pointers.get(first)?.point;
    const b = pointers.get(second)?.point;
    if (!a || !b) return [];
    const from = [a, b] as const;
    const to = pointerId === first ? ([point, b] as const) : ([a, point] as const);
    return [{ type: "Pinch", from, to }];
  };

  const move = (pointerId: number, point: Point): Effect[] => {
    const tracked = pointers.get(pointerId);
    if (!tracked) return [];
    const effects: Effect[] = [];
    if (state.mode === "Draw" && state.pointerId === pointerId) {
      effects.push({ type: "ExtendStroke" });
    }
    if (state.mode === "Pan" && state.pointerId === pointerId) {
      effects.push({ type: "Pan", dx: point.x - tracked.point.x, dy: point.y - tracked.point.y });
    }
    if (state.mode === "Pinch") effects.push(...pinchEffect(pointerId, point));
    pointers.set(pointerId, { ...tracked, point });
    return effects;
  };

  const end = (pointerId: number, cancelled: boolean): Effect[] => {
    if (!pointers.delete(pointerId)) return [];
    const effects: Effect[] = [];
    if (state.mode === "Draw" && state.pointerId === pointerId) {
      effects.push({ type: cancelled ? "DiscardStroke" : "CommitStroke" });
      state = touchIds().length > 0 ? { mode: "Pinch" } : { mode: "Idle" };
    }
    if (state.mode === "Pan" && state.pointerId === pointerId) state = { mode: "Idle" };
    if (state.mode === "Pinch" && touchIds().length === 0) state = { mode: "Idle" };
    if (pointers.size === 0) state = { mode: "Idle" };
    return effects;
  };

  return {
    down,
    move,
    up: (pointerId) => end(pointerId, false),
    cancel: (pointerId) => end(pointerId, true),
  };
}
