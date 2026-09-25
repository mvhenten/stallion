import { type BoardStore, openBoardStore, type StoredObject } from "@stallion/client-store";
import { type Point, type Tile, tileBounds, viewTiles } from "@stallion/geometry";
import type { PencilSize, Stroke } from "@stallion/schema";
import {
  type Camera,
  pan,
  pinch,
  screenToWorld,
  viewBounds,
  wheelFactor,
  worldToScreen,
  zoomAt,
} from "./camera";
import { isVisible } from "./culling";
import {
  type Draft,
  draftScreenPath,
  finishDraft,
  localScale,
  MAX_POINTS,
  PALETTE,
  startDraft,
  strokeLocalPath,
} from "./stroke";

export type Tool = { size: PencilSize; primary: number; secondary: number };

type Entry = { tile: Tile; stroke: Stroke; path: Path2D };

type Tracked = { point: Point; type: string };

type Mode = "Idle" | "Draw" | "Gesture" | "Pan";

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

const isCamera = (value: unknown): value is Camera => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, zoom } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof zoom === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    zoom > 0 &&
    Number.isFinite(zoom)
  );
};

const cameraKey = (boardId: string): string => `stallion:camera:${boardId}`;

const loadCamera = (boardId: string): Camera => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cameraKey(boardId)) ?? "null");
    return isCamera(parsed) ? parsed : DEFAULT_CAMERA;
  } catch {
    return DEFAULT_CAMERA;
  }
};

const saveCamera = (boardId: string, camera: Camera): void => {
  try {
    localStorage.setItem(cameraKey(boardId), JSON.stringify(camera));
  } catch {
    // Camera position is a per-viewer convenience; losing it only recentres the board.
  }
};

export type Surface = { dispose(): void };

export function createSurface(
  canvas: HTMLCanvasElement,
  boardId: string,
  currentTool: () => Tool,
  onError: (message: string) => void,
): Surface {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D canvas context.");
  const ctx = context;

  const entries = new Map<string, Entry>();
  let ordered: Entry[] = [];
  let camera = loadCamera(boardId);
  let mode: Mode = "Idle";
  let draft: Draft | undefined;
  let draftPointer: number | undefined;
  let penSeen = false;
  let spaceDown = false;
  let frame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const pointers = new Map<number, Tracked>();

  const fail = (action: string) => (error: unknown) => {
    onError(`${action}: ${error instanceof Error ? error.message : String(error)}`);
  };

  const storeReady: Promise<BoardStore> = openBoardStore(boardId);
  storeReady.catch(fail("Could not open the local board storage"));

  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });

  const render = () => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const view = viewBounds(camera, width, height);
    for (const entry of ordered) {
      if (!isVisible(entry.stroke.bbox, view, camera.zoom)) continue;
      const origin = tileBounds(entry.tile);
      const scale = localScale(entry.tile) * camera.zoom * dpr;
      ctx.setTransform(
        scale,
        0,
        0,
        scale,
        (origin.minX - camera.x) * camera.zoom * dpr,
        (origin.minY - camera.y) * camera.zoom * dpr,
      );
      ctx.fillStyle = PALETTE[entry.stroke.colour] ?? PALETTE[0];
      ctx.fill(entry.path);
    }
    if (draft && draft.points.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PALETTE[draft.colour] ?? PALETTE[0];
      ctx.fill(draftScreenPath(draft, (world) => worldToScreen(camera, world), camera.zoom));
    }
  };

  const requestRender = () => {
    if (frame === 0) frame = requestAnimationFrame(render);
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    render();
  };

  const add = ({ tile, object }: StoredObject) => {
    if (object.type !== "Stroke" || entries.has(object.objectId)) return;
    const entry = { tile, stroke: object, path: strokeLocalPath(tile, object) };
    entries.set(object.objectId, entry);
    const index = ordered.findIndex((other) => other.stroke.objectId > object.objectId);
    ordered = index === -1 ? [...ordered, entry] : ordered.toSpliced(index, 0, entry);
  };

  const loadView = () => {
    const { width, height } = size();
    const view = viewTiles(viewBounds(camera, width, height), camera.zoom);
    storeReady
      .then((store) => store.query([...view.live, ...view.snapshot]))
      .then((found) => {
        for (const stored of found) add(stored);
        requestRender();
      })
      .catch(fail("Could not load the board from local storage"));
  };

  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      saveCamera(boardId, camera);
      loadView();
    }, 150);
  };

  const moveCamera = (next: Camera) => {
    camera = next;
    requestRender();
    settle();
  };

  const commit = () => {
    if (!draft) return;
    const stored = finishDraft(draft);
    draft = undefined;
    if (!stored) return;
    add(stored);
    storeReady
      .then((store) => store.put(stored))
      .catch(fail("Could not save the stroke to local storage"));
  };

  const cancelDraft = () => {
    draft = undefined;
    draftPointer = undefined;
    requestRender();
  };

  const localPoint = (event: PointerEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const addPoint = (event: PointerEvent) => {
    if (!draft) return;
    const world = screenToWorld(camera, localPoint(event));
    const pressure = event.pointerType === "pen" ? Math.min(1, Math.max(0, event.pressure)) : 0.5;
    if (draft.points.length >= MAX_POINTS) {
      const last = draft.points.at(-1);
      const next: Draft = { ...draft, points: last ? [last] : [] };
      commit();
      draft = next;
    }
    draft.points.push([world.x, world.y, pressure]);
  };

  const touches = (): Tracked[] =>
    [...pointers.values()].filter((tracked) => tracked.type === "touch");

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { point: localPoint(event), type: event.pointerType });
    if (event.pointerType === "pen") penSeen = true;

    if (event.pointerType === "touch") {
      if (touches().length >= 2) {
        if (
          mode === "Draw" &&
          draftPointer !== undefined &&
          pointers.get(draftPointer)?.type === "touch"
        ) {
          cancelDraft();
        }
        if (mode !== "Draw") mode = "Gesture";
        return;
      }
      if (penSeen) {
        if (mode === "Idle") mode = "Gesture";
        return;
      }
    }

    if (mode !== "Idle") return;
    if (event.pointerType === "mouse" && (event.button === 1 || spaceDown)) {
      mode = "Pan";
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    const tool = currentTool();
    draft = startDraft(event.button === 2 ? tool.secondary : tool.primary, tool.size, camera.zoom);
    draftPointer = event.pointerId;
    mode = "Draw";
    addPoint(event);
    requestRender();
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = localPoint(event);

    if (mode === "Draw" && event.pointerId === draftPointer) {
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length > 0 ? samples : [event]) addPoint(sample);
      requestRender();
    }

    if (mode === "Gesture") {
      const others = [...pointers.entries()].filter(
        ([id, tracked]) => id !== event.pointerId && tracked.type === "touch",
      );
      const partner = others[0]?.[1];
      if (partner) {
        moveCamera(pinch(camera, [previous.point, partner.point], [point, partner.point]));
      } else {
        moveCamera(pan(camera, point.x - previous.point.x, point.y - previous.point.y));
      }
    }

    if (mode === "Pan") {
      moveCamera(pan(camera, point.x - previous.point.x, point.y - previous.point.y));
    }

    pointers.set(event.pointerId, { point, type: previous.type });
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (mode === "Draw" && event.pointerId === draftPointer) {
      if (event.type === "pointercancel") {
        cancelDraft();
      } else {
        commit();
        draftPointer = undefined;
        requestRender();
      }
      mode = touches().length > 0 ? "Gesture" : "Idle";
      return;
    }
    if (pointers.size === 0) mode = "Idle";
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = wheelFactor(event.ctrlKey ? event.deltaY * 3 : event.deltaY, event.deltaMode);
    moveCamera(zoomAt(camera, localPoint(event), factor));
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    spaceDown = event.type === "keydown";
  };

  const preventDefault = (event: Event) => event.preventDefault();

  const observer = new ResizeObserver(() => {
    resize();
    settle();
  });
  observer.observe(canvas);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", preventDefault);
  canvas.addEventListener("touchstart", preventDefault, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  resize();
  loadView();

  return {
    dispose() {
      clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", preventDefault);
      canvas.removeEventListener("touchstart", preventDefault);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      saveCamera(boardId, camera);
      storeReady.then((store) => store.close()).catch(() => undefined);
    },
  };
}
