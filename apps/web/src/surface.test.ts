import type { StoredObject } from "@stallion/client-store";
import type { LiveObjects } from "@stallion/client-sync";
import { afterEach, expect, test, vi } from "vitest";
import { createSurface, PAPER } from "./surface";
import type { BoardSource } from "./sync";

const stored: StoredObject = {
  tile: { level: 0, tx: 0, ty: 0 },
  object: {
    type: "Stroke",
    objectId: "000000000aaaaaaaaaaaa",
    nativeZoom: 0,
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    colour: 0,
    size: "Medium",
    points: [
      [1, 1, 0.5],
      [8, 8, 0.5],
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

test("each frame paints the paper before any stroke", () => {
  const calls: string[] = [];
  const context = {
    setTransform: () => undefined,
    clearRect: () => calls.push("clearRect"),
    fillRect: function (this: { fillStyle: string }) {
      calls.push(`fillRect ${this.fillStyle}`);
    },
    fill: function (this: { fillStyle: string }) {
      calls.push(`fill ${this.fillStyle}`);
    },
    fillStyle: "",
  };
  const listen = { addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("window", { ...listen, devicePixelRatio: 1 });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "Path2D",
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    },
  );
  const canvas = {
    ...listen,
    clientWidth: 400,
    clientHeight: 300,
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const objects = {
    get: () => stored,
    keys: () => [stored.object.objectId][Symbol.iterator](),
    observe: () => () => undefined,
  } as unknown as LiveObjects;
  const source: BoardSource = {
    view: () => undefined,
    commit: () => undefined,
    erase: () => undefined,
    objects,
    history: {
      undo: () => undefined,
      redo: () => undefined,
      checkpoint: () => undefined,
      canUndo: false,
      canRedo: false,
      observe: () => () => undefined,
    },
    awareness: undefined,
    close: () => Promise.resolve(),
  };

  const surface = createSurface(canvas, "board", source, () => ({
    size: "Medium",
    primary: 0,
    secondary: 4,
    mode: "Pencil",
  }));
  calls.length = 0;
  for (const callback of frames.splice(0)) callback(0);
  surface.dispose();

  expect(calls).toEqual([`fillRect ${PAPER}`, "fill #1f2328"]);
});
