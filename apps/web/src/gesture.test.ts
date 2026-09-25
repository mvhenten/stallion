import { expect, test } from "vitest";
import { createGestures, type Effect } from "./gesture";

const idle = { panTool: false, spaceDown: false };

test("a second finger turns a stroke into a pinch that zooms and pans, and draws nothing", () => {
  const gestures = createGestures();
  const effects: Effect[] = [
    ...gestures.down({ pointerId: 1, kind: "touch", button: 0, point: { x: 100, y: 100 } }, idle),
    ...gestures.move(1, { x: 102, y: 100 }),
    ...gestures.down({ pointerId: 2, kind: "touch", button: 0, point: { x: 200, y: 100 } }, idle),
    ...gestures.move(1, { x: 60, y: 140 }),
    ...gestures.move(2, { x: 260, y: 140 }),
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
