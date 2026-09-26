import { expect, test } from "vitest";
import { createInput, type DragInput, type Effect } from "./input";

const idle = { panTool: false, spaceDown: false };

const touch = (x: number, y: number, time: number, phase: Partial<DragInput> = {}): DragInput => ({
  first: false,
  last: false,
  cancelled: false,
  intentional: true,
  kind: "touch",
  button: 0,
  point: { x, y },
  time,
  ...phase,
});

const pinch = (x: number, y: number, distance: number, first = false) => ({
  first,
  last: false,
  origin: { x, y },
  distance,
});

test("a parallel two-finger drag pans and never zooms or draws", () => {
  const input = createInput();
  const effects: Effect[] = [
    ...input.drag(touch(100, 100, 0, { first: true, intentional: false }), idle),
    ...input.pinch(pinch(150, 100, 100, true)),
    ...input.tick(90),
    ...input.drag(touch(140, 100, 100), idle),
    ...input.pinch(pinch(190, 100, 104)),
    ...input.pinch(pinch(230, 130, 96)),
    ...input.drag(touch(180, 130, 120, { last: true }), idle),
  ];
  expect(effects.map((effect) => effect.type)).toEqual(["Pinch", "Pinch"]);
  expect(effects.every((effect) => effect.type === "Pinch" && effect.factor === 1)).toBe(true);
  expect(effects.at(-1)).toEqual({
    type: "Pinch",
    anchor: { x: 190, y: 100 },
    factor: 1,
    dx: 40,
    dy: 30,
  });
});

test("a finger distance change beyond the threshold zooms around the midpoint", () => {
  const input = createInput();
  input.pinch(pinch(150, 100, 100, true));
  const [cross] = input.pinch(pinch(150, 100, 120));
  const [grow] = input.pinch(pinch(150, 100, 180));
  expect(cross).toMatchObject({ type: "Pinch", factor: 1 });
  expect(grow).toMatchObject({ type: "Pinch", factor: 1.5, anchor: { x: 150, y: 100 } });
});

test("a second finger discards the stroke the first finger started", () => {
  const input = createInput();
  const effects = [
    ...input.drag(touch(100, 100, 0, { first: true, intentional: false }), idle),
    ...input.drag(touch(120, 100, 20), idle),
    ...input.pinch(pinch(150, 100, 100, true)),
    ...input.drag(touch(130, 100, 40), idle),
  ];
  expect(effects.map((effect) => effect.type)).toEqual([
    "StartStroke",
    "ExtendStroke",
    "DiscardStroke",
  ]);
});

test("a touch waits for intent while mouse and pen start on pointerdown", () => {
  const input = createInput();
  expect(input.drag(touch(0, 0, 0, { first: true, intentional: false }), idle)).toEqual([]);
  expect(input.drag(touch(2, 0, 10, { intentional: false }), idle)).toEqual([]);
  expect(input.tick(60)).toEqual([
    { type: "StartStroke", secondary: false, point: { x: 0, y: 0 } },
  ]);
  input.drag(touch(2, 0, 70, { last: true }), idle);

  const pen = input.drag({ ...touch(5, 5, 100, { first: true }), kind: "pen" }, idle);
  expect(pen).toEqual([{ type: "StartStroke", secondary: false, point: { x: 5, y: 5 } }]);
});
