import { expect, test } from "vitest";
import type { Camera } from "./camera";
import { createFollow, FOLLOW_ANIMATION_MS } from "./follow";
import { type PeerState, viewportOf } from "./presence";

const WIDTH = 400;
const HEIGHT = 300;

const setup = () => {
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let now = 0;
  const frames = new Map<number, (now: number) => void>();
  let handle = 0;
  const changes: (number | undefined)[] = [];
  const follow = createFollow({
    camera: () => camera,
    size: () => ({ width: WIDTH, height: HEIGHT }),
    move: (next) => {
      camera = next;
    },
    requestFrame: (step) => {
      handle += 1;
      frames.set(handle, step);
      return handle;
    },
    cancelFrame: (id) => frames.delete(id),
    now: () => now,
    onChange: (target) => changes.push(target),
  });
  const flush = (ms: number) => {
    now += ms;
    for (const [id, step] of [...frames]) {
      frames.delete(id);
      step(now);
    }
  };
  return { follow, flush, changes, camera: () => camera, pending: () => frames.size };
};

const peer = (clientId: number, viewport: PeerState["viewport"]): PeerState => ({
  clientId,
  name: "grace",
  colour: "red",
  self: false,
  viewport,
});

test("a followed viewport update moves the camera, a local pan stops it", () => {
  const { follow, flush, changes, camera, pending } = setup();
  follow.peers([peer(7, { x: 0, y: 0, zoom: 1 })]);
  follow.start(7);
  expect(follow.target).toBe(7);

  follow.peers([peer(7, { x: 500, y: -200, zoom: 4 })]);
  flush(FOLLOW_ANIMATION_MS / 2);
  expect(viewportOf(camera(), WIDTH, HEIGHT).x).toBeGreaterThan(200);
  flush(FOLLOW_ANIMATION_MS);
  const reached = viewportOf(camera(), WIDTH, HEIGHT);
  expect(reached.x).toBeCloseTo(500);
  expect(reached.y).toBeCloseTo(-200);
  expect(reached.zoom).toBeCloseTo(4);

  follow.peers([peer(7, { x: 900, y: 0, zoom: 4 })]);
  follow.stop();
  flush(FOLLOW_ANIMATION_MS);
  expect(pending()).toBe(0);
  expect(viewportOf(camera(), WIDTH, HEIGHT).x).toBeCloseTo(500);
  expect(follow.target).toBeUndefined();
  expect(changes).toEqual([7, undefined]);
});

test("following ends when the followed user leaves", () => {
  const { follow, changes } = setup();
  follow.peers([peer(7, undefined)]);
  follow.start(7);
  follow.peers([]);
  expect(follow.target).toBeUndefined();
  expect(changes).toEqual([7, undefined]);
});
