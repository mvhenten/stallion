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
import { hitsStroke } from "./eraser";
import { createGestures, type Effect, type PointerKind } from "./gesture";
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

export type ToolMode = "Pencil" | "Pan" | "Eraser";

export type Tool = { size: PencilSize; primary: number; secondary: number; mode: ToolMode };

type Entry = { tile: Tile; stroke: Stroke; path: Path2D };

const BLOCKED_TOUCH_EVENTS = [
  "touchstart",
  "touchmove",
  "gesturestart",
  "gesturechange",
  "gestureend",
] as const;

const ERASER_STEP_PX = 4;

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
  let draft: Draft | undefined;
  let eraser: Point | undefined;
  const erased = new Set<string>();
  let spaceDown = false;
  let frame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const gestures = createGestures();

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
    if (object.type !== "Stroke" || entries.has(object.objectId) || erased.has(object.objectId)) {
      return;
    }
    const entry = { tile, stroke: object, path: strokeLocalPath(tile, object) };
    entries.set(object.objectId, entry);
    const index = ordered.findIndex((other) => other.stroke.objectId > object.objectId);
    ordered = index === -1 ? [...ordered, entry] : ordered.toSpliced(index, 0, entry);
  };

  const erase = (entry: Entry) => {
    const { objectId } = entry.stroke;
    erased.add(objectId);
    entries.delete(objectId);
    ordered = ordered.filter((other) => other !== entry);
    storeReady
      .then((store) => store.remove(objectId, entry.tile))
      .catch(fail("Could not delete the stroke from local storage"));
  };

  const eraseAt = (screen: Point) => {
    const { width, height } = size();
    const view = viewBounds(camera, width, height);
    const world = screenToWorld(camera, screen);
    for (const entry of ordered) {
      if (!isVisible(entry.stroke.bbox, view, camera.zoom)) continue;
      if (hitsStroke(entry.tile, entry.stroke, world, camera.zoom)) erase(entry);
    }
  };

  const eraseTo = (screen: Point) => {
    const from = eraser ?? screen;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(screen.x - from.x, screen.y - from.y) / ERASER_STEP_PX),
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      eraseAt({ x: from.x + (screen.x - from.x) * t, y: from.y + (screen.y - from.y) * t });
    }
    eraser = screen;
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
    if (!isCamera(next)) return;
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

  const pointerKind = (event: PointerEvent): PointerKind =>
    event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";

  const apply = (effects: readonly Effect[], event: PointerEvent) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "StartStroke": {
          const tool = currentTool();
          if (tool.mode === "Eraser") {
            eraser = undefined;
            eraseTo(localPoint(event));
            break;
          }
          draft = startDraft(
            effect.secondary ? tool.secondary : tool.primary,
            tool.size,
            camera.zoom,
          );
          addPoint(event);
          break;
        }
        case "ExtendStroke": {
          const samples = event.getCoalescedEvents?.() ?? [];
          for (const sample of samples.length > 0 ? samples : [event]) {
            if (eraser) eraseTo(localPoint(sample));
            else addPoint(sample);
          }
          break;
        }
        case "CommitStroke":
          eraser = undefined;
          commit();
          break;
        case "DiscardStroke":
          eraser = undefined;
          draft = undefined;
          break;
        case "Pan":
          moveCamera(pan(camera, effect.dx, effect.dy));
          break;
        case "Pinch":
          moveCamera(pinch(camera, effect.from, effect.to));
          break;
      }
    }
    if (effects.length > 0) requestRender();
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const effects = gestures.down(
      {
        pointerId: event.pointerId,
        kind: pointerKind(event),
        button: event.button,
        point: localPoint(event),
      },
      { panTool: currentTool().mode === "Pan", spaceDown },
    );
    apply(effects, event);
  };

  const onPointerMove = (event: PointerEvent) => {
    apply(gestures.move(event.pointerId, localPoint(event)), event);
  };

  const onPointerUp = (event: PointerEvent) => {
    apply(gestures.up(event.pointerId), event);
  };

  const onPointerCancel = (event: PointerEvent) => {
    apply(gestures.cancel(event.pointerId), event);
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
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", preventDefault);
  for (const type of BLOCKED_TOUCH_EVENTS) {
    canvas.addEventListener(type, preventDefault, { passive: false });
  }
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
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", preventDefault);
      for (const type of BLOCKED_TOUCH_EVENTS) canvas.removeEventListener(type, preventDefault);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      saveCamera(boardId, camera);
      storeReady.then((store) => store.close()).catch(() => undefined);
    },
  };
}
