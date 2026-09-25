import type { StoredObject } from "@stallion/client-store";
import type { Point, Tile } from "@stallion/geometry";
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
  MAX_POINTS,
  PALETTE,
  type StrokeFrame,
  startDraft,
  strokeFrame,
  strokeFramePath,
  translateStroke,
} from "./stroke";
import type { BoardSource } from "./sync";

export type ToolMode = "Pencil" | "Pan" | "Eraser" | "Select";

export type Tool = { size: PencilSize; primary: number; secondary: number; mode: ToolMode };

type Entry = { tile: Tile; stroke: Stroke; frame: StrokeFrame; path: Path2D };

type Drag = { objectId: string; from: Point; dx: number; dy: number };

const SELECTION = "#0090ff";

const BLOCKED_TOUCH_EVENTS = [
  "touchstart",
  "touchmove",
  "gesturestart",
  "gesturechange",
  "gestureend",
] as const;

const ERASER_STEP_PX = 4;

const CURSOR_THROTTLE_MS = 50;

type RemoteCursor = { x: number; y: number; name: string; colour: string };

const remoteCursor = (clientId: number, state: unknown): RemoteCursor | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  const { cursor, user } = state as Record<string, unknown>;
  if (typeof cursor !== "object" || cursor === null) return undefined;
  const { x, y } = cursor as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  const name =
    typeof user === "object" &&
    user !== null &&
    typeof (user as { name?: unknown }).name === "string"
      ? (user as { name: string }).name
      : "Guest";
  return { x, y, name, colour: PALETTE[clientId % PALETTE.length] ?? PALETTE[0] };
};

export const PAPER = "#fbfaf7";

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
  source: BoardSource,
  currentTool: () => Tool,
): Surface {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D canvas context.");
  const ctx = context;

  const entries = new Map<string, Entry>();
  let ordered: Entry[] = [];
  let camera = loadCamera(boardId);
  let draft: Draft | undefined;
  let eraser: Point | undefined;
  let selected: string | undefined;
  let drag: Drag | undefined;
  let spaceDown = false;
  let frame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let cursors: RemoteCursor[] = [];
  let cursorSentAt = 0;
  const gestures = createGestures();
  const awareness = source.awareness;

  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });

  const render = () => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const view = viewBounds(camera, width, height);
    for (const entry of ordered) {
      const dragged = drag?.objectId === entry.stroke.objectId ? drag : undefined;
      if (!dragged && !isVisible(entry.stroke.bbox, view, camera.zoom)) continue;
      const offset = dragged ?? { dx: 0, dy: 0 };
      const { origin } = entry.frame;
      const scale = entry.frame.scale * camera.zoom * dpr;
      ctx.setTransform(
        scale,
        0,
        0,
        scale,
        (origin.x + offset.dx - camera.x) * camera.zoom * dpr,
        (origin.y + offset.dy - camera.y) * camera.zoom * dpr,
      );
      ctx.fillStyle = PALETTE[entry.stroke.colour] ?? PALETTE[0];
      ctx.fill(entry.path);
    }
    if (draft && draft.points.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PALETTE[draft.colour] ?? PALETTE[0];
      ctx.fill(draftScreenPath(draft, (world) => worldToScreen(camera, world), camera.zoom));
    }
    renderSelection(dpr);
    if (cursors.length > 0) renderCursors(dpr);
  };

  const renderSelection = (dpr: number) => {
    const entry = selected === undefined ? undefined : entries.get(selected);
    if (!entry) return;
    const { dx, dy } = drag ?? { dx: 0, dy: 0 };
    const { bbox } = entry.stroke;
    const topLeft = worldToScreen(camera, { x: bbox.minX + dx, y: bbox.minY + dy });
    const bottomRight = worldToScreen(camera, { x: bbox.maxX + dx, y: bbox.maxY + dy });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      topLeft.x - 4,
      topLeft.y - 4,
      bottomRight.x - topLeft.x + 8,
      bottomRight.y - topLeft.y + 8,
    );
    ctx.setLineDash([]);
  };

  const renderCursors = (dpr: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const cursor of cursors) {
      const { x, y } = worldToScreen(camera, cursor);
      ctx.fillStyle = cursor.colour;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(cursor.name, x + 9, y);
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
    if (object.type !== "Stroke") return;
    const frame = strokeFrame(tile, object);
    const entry = { tile, stroke: object, frame, path: strokeFramePath(object, frame) };
    const previous = entries.get(object.objectId);
    entries.set(object.objectId, entry);
    const rest = previous ? ordered.filter((other) => other !== previous) : ordered;
    const index = rest.findIndex((other) => other.stroke.objectId > object.objectId);
    ordered =
      index === -1 ? [...rest, entry] : [...rest.slice(0, index), entry, ...rest.slice(index)];
  };

  const eraseAt = (screen: Point) => {
    const { width, height } = size();
    const view = viewBounds(camera, width, height);
    const world = screenToWorld(camera, screen);
    for (const entry of ordered) {
      if (!isVisible(entry.stroke.bbox, view, camera.zoom)) continue;
      if (hitsStroke(entry.tile, entry.stroke, world, camera.zoom))
        source.erase(entry.stroke.objectId);
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

  const pick = (screen: Point): Entry | undefined => {
    const { width, height } = size();
    const view = viewBounds(camera, width, height);
    const world = screenToWorld(camera, screen);
    return ordered.findLast(
      (entry) =>
        isVisible(entry.stroke.bbox, view, camera.zoom) &&
        hitsStroke(entry.tile, entry.stroke, world, camera.zoom),
    );
  };

  const startDrag = (screen: Point) => {
    const hit = pick(screen);
    selected = hit?.stroke.objectId;
    drag = hit && {
      objectId: hit.stroke.objectId,
      from: screenToWorld(camera, screen),
      dx: 0,
      dy: 0,
    };
  };

  const dragTo = (screen: Point) => {
    if (!drag) return;
    const world = screenToWorld(camera, screen);
    drag = { ...drag, dx: world.x - drag.from.x, dy: world.y - drag.from.y };
  };

  const drop = () => {
    const moved = drag;
    drag = undefined;
    const entry = moved && entries.get(moved.objectId);
    if (!moved || !entry || (moved.dx === 0 && moved.dy === 0)) return;
    const stored = translateStroke(entry.tile, entry.stroke, moved.dx, moved.dy);
    if (stored) source.commit(stored);
  };

  const discard = (objectId: string) => {
    if (selected === objectId && !source.objects.has(objectId)) selected = undefined;
    const entry = entries.get(objectId);
    if (!entry) return;
    entries.delete(objectId);
    ordered = ordered.filter((other) => other !== entry);
  };

  const onObjects = (changed: ReadonlySet<string>) => {
    for (const objectId of changed) {
      const stored = source.objects.get(objectId);
      if (stored) add(stored);
      else discard(objectId);
    }
    requestRender();
  };

  const onAwareness = () => {
    if (!awareness) return;
    cursors = [...awareness.getStates()].flatMap(([clientId, state]) => {
      if (clientId === awareness.clientID) return [];
      const cursor = remoteCursor(clientId, state);
      return cursor ? [cursor] : [];
    });
    requestRender();
  };

  const shareCursor = (screen: Point | undefined) => {
    if (!awareness) return;
    if (!screen) {
      awareness.setLocalStateField("cursor", null);
      return;
    }
    const now = performance.now();
    if (now - cursorSentAt < CURSOR_THROTTLE_MS) return;
    cursorSentAt = now;
    awareness.setLocalStateField("cursor", screenToWorld(camera, screen));
  };

  const updateView = () => {
    const { width, height } = size();
    source.view(viewBounds(camera, width, height), camera.zoom);
  };

  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => saveCamera(boardId, camera), 150);
    updateView();
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
    source.commit(stored);
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
          if (tool.mode === "Select") {
            startDrag(localPoint(event));
            break;
          }
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
            if (drag) dragTo(localPoint(sample));
            else if (eraser) eraseTo(localPoint(sample));
            else addPoint(sample);
          }
          break;
        }
        case "CommitStroke":
          eraser = undefined;
          drop();
          commit();
          break;
        case "DiscardStroke":
          eraser = undefined;
          drag = undefined;
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
    shareCursor(localPoint(event));
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
    if (event.type === "keydown" && (event.key === "Delete" || event.key === "Backspace")) {
      if (selected === undefined || currentTool().mode !== "Select") return;
      event.preventDefault();
      source.erase(selected);
      selected = undefined;
      requestRender();
      return;
    }
    if (event.code !== "Space") return;
    event.preventDefault();
    spaceDown = event.type === "keydown";
  };

  const onPointerLeave = () => shareCursor(undefined);

  const preventDefault = (event: Event) => event.preventDefault();

  const unobserve = source.objects.observe(onObjects);
  awareness?.on("change", onAwareness);

  const observer = new ResizeObserver(() => {
    resize();
    settle();
  });
  observer.observe(canvas);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", preventDefault);
  for (const type of BLOCKED_TOUCH_EVENTS) {
    canvas.addEventListener(type, preventDefault, { passive: false });
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  resize();
  onObjects(new Set(source.objects.keys()));
  onAwareness();
  updateView();

  return {
    dispose() {
      clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", preventDefault);
      for (const type of BLOCKED_TOUCH_EVENTS) canvas.removeEventListener(type, preventDefault);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      unobserve();
      awareness?.off("change", onAwareness);
      saveCamera(boardId, camera);
    },
  };
}
