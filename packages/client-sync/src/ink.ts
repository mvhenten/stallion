import {
  type InkFrame,
  inkFrame,
  MAX_INK_POINTS,
  type PencilSize,
  type Point,
  withRgb,
  withWidth,
} from "@stallion/schema";

export const INK_FIELD = "ink";
export const INK_INTERVAL_MS = 33;
export const INK_FULL_RESEND_MS = 1000;
export const INK_MAX_BYTES = 4096;

const POINT_BYTES = 48;

export type InkStroke = {
  strokeId: string;
  colour: number;
  rgb: number;
  size: PencilSize;
  width: number;
  nativeZoom: number;
};

export type LiveInk = InkStroke & { points: Point[] };

export type InkTarget = { setLocalStateField(field: string, value: unknown): void };

export type InkClock = {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
};

const systemClock: InkClock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export type InkPublisher = {
  start(stroke: InkStroke): void;
  extend(points: readonly Point[]): void;
  finish(): void;
  clear(): void;
};

export function createInkPublisher(target: InkTarget, clock: InkClock = systemClock): InkPublisher {
  let ink: LiveInk | undefined;
  let sent = 0;
  let sentAt = Number.NEGATIVE_INFINITY;
  let fullAt = Number.NEGATIVE_INFINITY;
  let timer: unknown;

  const cancel = (): void => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };

  const emit = (): void => {
    timer = undefined;
    if (!ink || ink.points.length === sent) return;
    const now = clock.now();
    const full =
      sent === 0 ||
      ink.points.length * POINT_BYTES <= INK_MAX_BYTES ||
      now - fullAt >= INK_FULL_RESEND_MS;
    const from = full ? 0 : sent;
    const { points, ...stroke } = ink;
    const frame: InkFrame = { ...stroke, from, points: points.slice(from) };
    target.setLocalStateField(INK_FIELD, frame);
    sent = points.length;
    sentAt = now;
    if (full) fullAt = now;
  };

  return {
    start(stroke) {
      cancel();
      ink = { ...stroke, points: [] };
      sent = 0;
      fullAt = Number.NEGATIVE_INFINITY;
    },
    extend(points) {
      if (!ink) return;
      const room = MAX_INK_POINTS - ink.points.length;
      ink.points.push(...points.slice(0, room));
      if (timer !== undefined) return;
      const wait = sentAt + INK_INTERVAL_MS - clock.now();
      if (wait <= 0) emit();
      else timer = clock.setTimeout(emit, wait);
    },
    finish() {
      cancel();
      emit();
    },
    clear() {
      cancel();
      const active = ink !== undefined || sent > 0;
      ink = undefined;
      sent = 0;
      if (active) target.setLocalStateField(INK_FIELD, null);
    },
  };
}

export type InkReader = {
  read(states: ReadonlyMap<number, unknown>, self: number): ReadonlyMap<number, LiveInk>;
};

const frameOf = (state: unknown): (InkFrame & { rgb: number; width: number }) | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  const parsed = inkFrame.safeParse((state as Record<string, unknown>)[INK_FIELD]);
  return parsed.success ? withWidth(withRgb(parsed.data)) : undefined;
};

export function createInkReader(): InkReader {
  const known = new Map<number, LiveInk>();
  return {
    read(states, self) {
      for (const clientId of known.keys()) {
        if (!states.has(clientId)) known.delete(clientId);
      }
      for (const [clientId, state] of states) {
        if (clientId === self) continue;
        const frame = frameOf(state);
        if (!frame) {
          known.delete(clientId);
          continue;
        }
        const { from, points, ...stroke } = frame;
        const previous = known.get(clientId);
        if (from === 0) {
          known.set(clientId, { ...stroke, points });
          continue;
        }
        if (previous?.strokeId !== frame.strokeId) {
          known.delete(clientId);
          continue;
        }
        if (from > previous.points.length) continue;
        const merged = [...previous.points.slice(0, from), ...points].slice(0, MAX_INK_POINTS);
        known.set(clientId, { ...stroke, points: merged });
      }
      return known;
    },
  };
}
