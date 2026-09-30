import type { StoredObject } from "@stallion/client-store";
import type { LiveObjects } from "@stallion/client-sync";
import type { Shape, Stroke } from "@stallion/schema";
import { afterEach, expect, test, vi } from "vitest";
import { shapeBounds, shapeLook, shapeWorldPoints } from "./shape";
import { type ContextTarget, createSurface, INK_ALPHA, PAPER, type Tool } from "./surface";
import type { Awareness, DrawingSource } from "./sync";

const stored: StoredObject & { object: Stroke } = {
  tile: { level: 0, tx: 0, ty: 0 },
  object: {
    type: "Stroke",
    objectId: "000000000aaaaaaaaaaaa",
    nativeZoom: 0,
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    colour: 0,
    rgb: 0x1f2328,
    size: "Medium",
    style: "Pen",
    points: [
      [1, 1, 0.5],
      [8, 8, 0.5],
    ],
  },
};

type Handler = (state: { event: unknown; intentional: boolean }) => void;

const gesture = vi.hoisted(() => ({ handlers: {} as Record<string, Handler> }));

vi.mock("@use-gesture/vanilla", () => ({
  Gesture: class {
    constructor(_target: unknown, handlers: Record<string, Handler>) {
      gesture.handlers = handlers;
    }
    destroy() {}
  },
}));

afterEach(() => vi.unstubAllGlobals());

const PENCIL: Tool = {
  width: 8,
  style: "Pen",
  primary: 0,
  secondary: 4,
  shape: "Rectangle",
  fill: "None",
  mode: "Pencil",
};

type Screen = { x: number; y: number };

const pointer = (type: string, { x, y }: Screen) => ({
  type,
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  clientX: x,
  clientY: y,
  timeStamp: 0,
  preventDefault: () => undefined,
});

const dragAlong = (from: Screen, to: Screen) => {
  const onDrag = gesture.handlers.onDrag;
  if (!onDrag) throw new Error("the surface bound no drag handler");
  onDrag({ event: pointer("pointerdown", from), intentional: false });
  onDrag({ event: pointer("pointermove", to), intentional: true });
  onDrag({ event: pointer("pointerup", to), intentional: true });
};

const harness = (initial: StoredObject[], awareness?: Awareness) => {
  const calls: string[] = [];
  const commits: StoredObject[] = [];
  const erased: string[] = [];
  const targets: (ContextTarget | undefined)[] = [];
  let checkpoints = 0;
  let tool = PENCIL;
  const context = {
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    ellipse: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    setLineDash: () => undefined,
    strokeRect: () => undefined,
    stroke: function (this: { strokeStyle: string }) {
      calls.push(`stroke ${this.strokeStyle}`);
    },
    strokeStyle: "",
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
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
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
    commit: (entry) => commits.push(entry),
    erase: (objectId) => erased.push(objectId),
    objects,
    hints: { current: [], observe: () => () => undefined },
    history: {
      undo: () => undefined,
      redo: () => undefined,
      checkpoint: () => {
        checkpoints += 1;
      },
      canUndo: false,
      canRedo: false,
      observe: () => () => undefined,
    },
    awareness,
    close: () => Promise.resolve(),
  };
  const surface = createSurface(
    canvas,
    "board",
    source,
    () => tool,
    undefined,
    undefined,
    undefined,
    undefined,
    (target) => targets.push(target),
  );
  const paint = () => {
    calls.length = 0;
    for (const callback of frames.splice(0)) callback(0);
    return [...calls];
  };
  const arrive = (entry: StoredObject) => {
    store.set(entry.object.objectId, entry);
    for (const observer of observers) observer(new Set([entry.object.objectId]));
  };
  const use = (next: Partial<Tool>) => {
    tool = { ...tool, ...next };
  };
  return { surface, paint, arrive, use, commits, erased, targets, checkpoints: () => checkpoints };
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

  arrive({ ...stored, object: { ...stored.object, colour: 4, rgb: 0x0090ff } });
  const calls = paint();
  surface.dispose();

  expect(calls).toEqual([`fillRect ${PAPER}`, "fill #0090ff"]);
});

test("draws a rectangle, moves it by its edge and erases it where it landed", () => {
  const { surface, paint, arrive, use, commits, erased } = harness([]);
  use({ mode: "Shape", shape: "Rectangle", fill: "Tint", primary: 0x8e4ec6 });
  dragAlong({ x: 100, y: 100 }, { x: 200, y: 150 });

  const [drawn] = commits;
  if (drawn?.object.type !== "Shape") throw new Error("no shape committed");
  expect(drawn.object).toMatchObject({ kind: "Rectangle", fill: "Tint", rgb: 0x8e4ec6 });
  expect(shapeWorldPoints(drawn.tile, drawn.object)).toEqual({
    start: { x: 100, y: 100 },
    end: { x: 200, y: 150 },
  });
  arrive(drawn);
  expect(paint()).toEqual([`fillRect ${PAPER}`, "ink #8e4ec6", "stroke #8e4ec6"]);

  use({ mode: "Select" });
  dragAlong({ x: 150, y: 100 }, { x: 150, y: 300 });
  const moved = commits[1];
  if (moved?.object.type !== "Shape") throw new Error("no move committed");
  expect(moved.object.objectId).toBe(drawn.object.objectId);
  const { start, end } = shapeWorldPoints(moved.tile, moved.object as Shape);
  expect(start.x).toBeCloseTo(100, 9);
  expect(start.y).toBeCloseTo(300, 9);
  expect(end.x).toBeCloseTo(200, 9);
  expect(end.y).toBeCloseTo(350, 9);
  arrive(moved);

  use({ mode: "Eraser" });
  dragAlong({ x: 150, y: 125 }, { x: 150, y: 125 });
  expect(erased).toEqual([]);
  dragAlong({ x: 150, y: 325 }, { x: 150, y: 325 });
  surface.dispose();

  expect(erased).toContain(drawn.object.objectId);
});

test("drags the bottom-right handle of a selected rectangle to double its size", () => {
  const { surface, arrive, use, commits } = harness([]);
  use({ mode: "Shape", shape: "Rectangle" });
  dragAlong({ x: 100, y: 100 }, { x: 200, y: 150 });
  const [drawn] = commits;
  if (drawn?.object.type !== "Shape") throw new Error("no shape committed");
  arrive(drawn);

  use({ mode: "Select" });
  dragAlong({ x: 150, y: 100 }, { x: 150, y: 100 });
  const { maxX, maxY } = drawn.object.bbox;
  dragAlong({ x: maxX + 4, y: maxY + 4 }, { x: maxX + 104, y: maxY + 54 });
  surface.dispose();

  const resized = commits[1];
  if (resized?.object.type !== "Shape") throw new Error("no resize committed");
  expect(resized.object.objectId).toBe(drawn.object.objectId);
  expect(resized.object.width).toBe(drawn.object.width);
  const { start, end } = shapeWorldPoints(resized.tile, resized.object);
  expect(start.x).toBeCloseTo(100, 9);
  expect(start.y).toBeCloseTo(100, 9);
  expect(end.x).toBeCloseTo(300, 9);
  expect(end.y).toBeCloseTo(200, 9);
  expect(resized.object.bbox).toEqual(shapeBounds(shapeLook(resized.object), start, end));
});

test("restyles a selected rectangle with a fill colour, no outline and half opacity", () => {
  const { surface, paint, arrive, use, commits, targets, checkpoints } = harness([]);
  use({ mode: "Shape", shape: "Rectangle" });
  dragAlong({ x: 100, y: 100 }, { x: 200, y: 150 });
  const [drawn] = commits;
  if (drawn?.object.type !== "Shape") throw new Error("no shape committed");
  expect(drawn.object).toMatchObject({ outline: true, opacity: 1 });
  expect(drawn.object).not.toHaveProperty("fillRgb");
  arrive(drawn);
  use({ mode: "Select" });
  dragAlong({ x: 150, y: 100 }, { x: 150, y: 100 });
  paint();
  expect(targets.at(-1)).toMatchObject({ kind: "Shape", objectId: drawn.object.objectId });

  surface.previewShape({ opacity: 0.25 });
  paint();
  expect(targets.at(-1)).toMatchObject({ kind: "Shape", opacity: 0.25 });
  expect(commits).toHaveLength(1);

  const before = checkpoints();
  const inked = () => paint().filter((call) => !call.startsWith("fillRect"));
  const apply = (change: Parameters<typeof surface.styleShape>[0]) => {
    surface.styleShape(change);
    const next = commits.at(-1);
    if (next?.object.type !== "Shape") throw new Error("no restyle committed");
    arrive(next);
    return next.object;
  };
  expect(apply({ fillRgb: 0x30a46c })).toMatchObject({
    fill: "Tint",
    fillRgb: 0x30a46c,
    opacity: 1,
  });
  expect(apply({ outline: false })).toMatchObject({ outline: false });
  expect(inked()).toEqual(["fill #30a46c"]);
  expect(apply({ opacity: 0.5 })).toMatchObject({ opacity: 0.5, bbox: drawn.object.bbox });
  expect(inked()).toEqual(["ink #30a46c"]);
  const bare = apply({ fill: "None" });
  surface.dispose();

  expect(bare).toMatchObject({ fill: "None", outline: true });
  expect(bare).not.toHaveProperty("fillRgb");
  expect(checkpoints() - before).toBe(4);
});
