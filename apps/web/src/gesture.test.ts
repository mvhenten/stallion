import { expect, test } from "vitest";
import { createGestures, type Effect, type PointerDown } from "./gesture";

const idle = { panTool: false, spaceDown: false };

const touch = (pointerId: number, x: number, y: number, time: number): PointerDown => ({
  pointerId,
  kind: "touch",
  button: 0,
  point: { x, y },
  time,
});

test("a second finger after the pending window turns a stroke into a pinch and discards it", () => {
  const gestures = createGestures();
  const effects: Effect[] = [
    ...gestures.down(touch(1, 100, 100, 0), idle),
    ...gestures.move(1, { x: 102, y: 100 }, 100),
    ...gestures.down(touch(2, 200, 100, 120), idle),
    ...gestures.move(1, { x: 60, y: 140 }, 130),
    ...gestures.move(2, { x: 260, y: 140 }, 140),
    ...gestures.up(1),
    ...gestures.up(2),
  ];
  const types = effects.map((effect) => effect.type);
  expect(types).toEqual(["StartStroke", "ExtendStroke", "DiscardStroke", "Pinch", "Pinch"]);
  expect(effects.at(-1)).toEqual({
    type: "Pinch",
    from: [
      { x: 60, y: 140 },
      { x: 200, y: 100 },
    ],
    to: [
      { x: 60, y: 140 },
      { x: 260, y: 140 },
    ],
  });
});

test("two touches 30 ms apart pan the board and never start an erase, while a tap still erases", () => {
  const gestures = createGestures();
  const pan: Effect[] = [
    ...gestures.down(touch(1, 100, 100, 0), idle),
    ...gestures.down(touch(2, 200, 100, 30), idle),
    ...gestures.tick(90),
    ...gestures.move(1, { x: 140, y: 100 }, 100),
    ...gestures.move(2, { x: 240, y: 100 }, 100),
    ...gestures.up(1),
    ...gestures.up(2),
  ];
  const types = pan.map((effect) => effect.type);
  expect(types).toEqual(["Pinch", "Pinch"]);
  expect(types.filter((type) => type === "StartStroke" || type === "ExtendStroke")).toEqual([]);

  const tap: Effect[] = [...gestures.down(touch(3, 100, 100, 500), idle), ...gestures.up(3)];
  expect(tap).toEqual([
    { type: "StartStroke", secondary: false, point: { x: 100, y: 100 } },
    { type: "CommitStroke" },
  ]);
});

test("a single touch starts once it moves past the slop or holds past the window", () => {
  const moved = createGestures();
  expect(moved.down(touch(1, 0, 0, 0), idle)).toEqual([]);
  expect(moved.move(1, { x: 3, y: 0 }, 10)).toEqual([]);
  expect(moved.move(1, { x: 20, y: 0 }, 20).map((effect) => effect.type)).toEqual([
    "StartStroke",
    "ExtendStroke",
  ]);

  const held = createGestures();
  held.down(touch(1, 0, 0, 0), idle);
  expect(held.tick(30)).toEqual([]);
  expect(held.tick(60)).toEqual([{ type: "StartStroke", secondary: false, point: { x: 0, y: 0 } }]);
});

test("mouse and pen start a stroke on pointerdown", () => {
  const gestures = createGestures();
  const down = { pointerId: 1, kind: "pen", button: 0, point: { x: 5, y: 5 }, time: 0 } as const;
  expect(gestures.down(down, idle)).toEqual([
    { type: "StartStroke", secondary: false, point: { x: 5, y: 5 } },
  ]);
});
