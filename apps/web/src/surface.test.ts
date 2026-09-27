import type { StoredObject } from "@stallion/client-store";
import type { LiveObjects } from "@stallion/client-sync";
import { afterEach, expect, test, vi } from "vitest";
import { createSurface, INK_ALPHA, PAPER } from "./surface";
import type { Awareness, DrawingSource } from "./sync";

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

const PENCIL = { size: "Medium", primary: 0, secondary: 4, mode: "Pencil" } as const;

const harness = (initial: StoredObject[], awareness?: Awareness) => {
  const calls: string[] = [];
  const context = {
    setTransform: () => undefined,
    clearRect: () => calls.push("clearRect"),
    fillRect: function (this: { fillStyle: string }) {
      calls.push(`fillRect ${this.fillStyle}`);
    },
    fill: function (this: { fillStyle: string; globalAlpha: number }) {
      calls.push(this.globalAlpha === 1 ? `fill ${this.fillStyle}` : `ink ${this.fillStyle}`);
    },
    fillStyle: "",
    globalAlpha: 1,
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
  const store = new Map(initial.map((entry) => [entry.object.objectId, entry]));
  const observers = new Set<(changed: ReadonlySet<string>) => void>();
  const objects = Object.assign(store, {
    observe(listener: (changed: ReadonlySet<string>) => void) {
      observers.add(listener);
      return () => observers.delete(listener);
    },
  }) as LiveObjects;
  const source: DrawingSource = {
    view: () => undefined,
    commit: () => undefined,
    erase: () => undefined,
    objects,
    hints: { current: [], observe: () => () => undefined },
    history: {
      undo: () => undefined,
      redo: () => undefined,
      checkpoint: () => undefined,
      canUndo: false,
      canRedo: false,
      observe: () => () => undefined,
    },
    awareness,
    close: () => Promise.resolve(),
  };
  const surface = createSurface(canvas, "board", source, () => PENCIL);
  const paint = () => {
    calls.length = 0;
    for (const callback of frames.splice(0)) callback(0);
    return [...calls];
  };
  const arrive = (entry: StoredObject) => {
    store.set(entry.object.objectId, entry);
    for (const observer of observers) observer(new Set([entry.object.objectId]));
  };
  return { surface, paint, arrive };
};

test("each frame paints the paper before any stroke", () => {
  const { surface, paint } = harness([stored]);
  const calls = paint();
  surface.dispose();

  expect(calls).toEqual([`fillRect ${PAPER}`, "fill #1f2328"]);
});

test("a remote stroke in progress gives way to its committed object", () => {
  const ink = {
    strokeId: stored.object.objectId,
    colour: 4,
    size: "Medium",
    nativeZoom: 0,
    from: 0,
    points: [
      [1, 1, 0.5],
      [8, 8, 0.5],
    ],
  };
  const states = new Map<number, unknown>([
    [1, {}],
    [2, { ink }],
  ]);
  const awareness = {
    clientID: 1,
    getStates: () => states,
    on: () => undefined,
    off: () => undefined,
    setLocalStateField: () => undefined,
  } as unknown as Awareness;
  const { surface, paint, arrive } = harness([], awareness);

  expect(INK_ALPHA).toBeLessThan(1);
  expect(paint()).toEqual([`fillRect ${PAPER}`, "ink #0090ff"]);

  arrive({ ...stored, object: { ...stored.object, colour: 4 } });
  const calls = paint();
  surface.dispose();

  expect(calls).toEqual([`fillRect ${PAPER}`, "fill #0090ff"]);
});
