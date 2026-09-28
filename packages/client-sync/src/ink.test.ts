import { inkFrame, type Point } from "@stallion/schema";
import { expect, test } from "vitest";
import {
  createInkPublisher,
  createInkReader,
  INK_FIELD,
  INK_FULL_RESEND_MS,
  INK_INTERVAL_MS,
  type InkClock,
} from "./ink";

const fakeClock = () => {
  let now = 0;
  let pending: { at: number; run: () => void } | undefined;
  const clock: InkClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      pending = { at: now + ms, run };
      return pending;
    },
    clearTimeout: (timer) => {
      if (timer === pending) pending = undefined;
    },
  };
  const advance = (ms: number) => {
    now += ms;
    if (pending && pending.at <= now) {
      const { run } = pending;
      pending = undefined;
      run();
    }
  };
  return { clock, advance };
};

test("the throttle publishes about 30 updates a second and the last one completes the stroke", () => {
  const { clock, advance } = fakeClock();
  const states: unknown[] = [];
  const publisher = createInkPublisher(
    { setLocalStateField: (field, value) => states.push({ [field]: value }) },
    clock,
  );
  const reader = createInkReader();
  const remote = () => reader.read(new Map([[7, states.at(-1)]]), 1).get(7);

  publisher.start({
    strokeId: "stroke-1",
    colour: 4,
    rgb: 0x0090ff,
    size: "Large",
    width: 20,
    style: "Highlighter",
    nativeZoom: 0,
  });
  const points: Point[] = [];
  const durationMs = 3 * INK_FULL_RESEND_MS;
  for (let ms = 0; ms < durationMs; ms++) {
    const point: Point = [ms * 1.5, ms * 0.5, 0.5];
    points.push(point);
    publisher.extend([point]);
    remote();
    advance(1);
  }
  publisher.finish();
  const final = remote();

  const perSecond = Math.ceil(1000 / INK_INTERVAL_MS) + 1;
  expect(states.length).toBeLessThanOrEqual((perSecond * durationMs) / 1000);
  expect(states.length).toBeGreaterThan(durationMs / 1000);
  const frames = states.map((state) => (state as Record<string, { from: number }>)[INK_FIELD]);
  expect(frames.some((frame) => frame && frame.from > 0)).toBe(true);
  expect(final?.points).toEqual(points);
  expect(final?.style).toBe("Highlighter");

  publisher.clear();
  expect(states.at(-1)).toEqual({ [INK_FIELD]: null });
  expect(reader.read(new Map([[7, states.at(-1)]]), 1).size).toBe(0);
});

test("a frame carries its style, and a frame from before styles reads as Pen", () => {
  const reader = createInkReader();
  const frame = {
    strokeId: "stroke-2",
    colour: 0,
    rgb: 0x1f2328,
    size: "Medium",
    width: 8,
    nativeZoom: 0,
    from: 0,
    points: [[1, 2, 0.5]],
  };
  expect(inkFrame.safeParse({ ...frame, style: "Dashed" }).success).toBe(true);
  expect(inkFrame.safeParse({ ...frame, style: "Marker" }).success).toBe(false);
  const states = new Map<number, unknown>([
    [7, { [INK_FIELD]: { ...frame, style: "Uniform" } }],
    [8, { [INK_FIELD]: frame }],
  ]);
  const inks = reader.read(states, 1);
  expect(inks.get(7)?.style).toBe("Uniform");
  expect(inks.get(8)?.style).toBe("Pen");
});
