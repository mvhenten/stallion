import type { StoredObject } from "@stallion/client-store";
import { createInkPublisher, createInkReader, type LiveInk } from "@stallion/client-sync";
import type { Point, Tile } from "@stallion/geometry";
import type { PencilSize, Stroke } from "@stallion/schema";
import { Gesture } from "@use-gesture/vanilla";
import {
  type Camera,
  pan,
  pinch,
  screenToWorld,
  viewBounds,
  wheelFactor,
  worldToScreen,
  zoomAt,
  zoomTo,
} from "./camera";
import { isVisible } from "./culling";
import { hitsStroke } from "./eraser";
import { createFollow } from "./follow";
import { createInput, DRAG_THRESHOLD_PX, type Effect, PENDING_MS, type PointerKind } from "./input";
import { easeOut, LEVEL_ANIMATION_MS, levelOf, zoomForLevel } from "./level";
import {
  displayName,
  PRESENCE_THROTTLE_MS,
  type Presence,
  peersOf,
  presenceColour,
  samePresence,
  type Viewport,
  viewportOf,
} from "./presence";
import {
  continueDraft,
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
import type { DrawingSource } from "./sync";

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

export const INK_ALPHA = 0.6;

type RemoteCursor = { x: number; y: number; name: string; colour: string };

const remoteCursor = (clientId: number, state: unknown): RemoteCursor | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  const { cursor, user } = state as Record<string, unknown>;
  if (typeof cursor !== "object" || cursor === null) return undefined;
  const { x, y } = cursor as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  const name = displayName(
    typeof user === "object" && user !== null ? (user as { name?: unknown }).name : undefined,
  );
  return { x, y, name, colour: presenceColour(clientId) };
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

export type SurfaceView = { level: number; contentLevels: readonly number[] };

export type Surface = {
  zoomToLevel(level: number): void;
  follow(clientId: number | undefined): void;
  dispose(): void;
};

const NO_PRESENCE: Presence = { peers: [], following: undefined };

export function createSurface(
  canvas: HTMLCanvasElement,
  boardId: string,
  source: DrawingSource,
  currentTool: () => Tool,
  onView: (view: SurfaceView) => void = () => undefined,
  onCommit: () => void = () => undefined,
  onPresence: (presence: Presence) => void = () => undefined,
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
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let cursors: RemoteCursor[] = [];
  let cursorSentAt = 0;
  let animation = 0;
  let reported: SurfaceView | undefined;
  let dragButton = 0;
  let presence = NO_PRESENCE;
  let published: Viewport | undefined;
  let publishedAt = Number.NEGATIVE_INFINITY;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  const input = createInput();
  const awareness = source.awareness;
  const publisher = awareness && createInkPublisher(awareness);
  const reader = createInkReader();
  const landed = new Set<string>();
  let inks: LiveInk[] = [];

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
    if (inks.length > 0) renderInks(dpr);
    if (draft && draft.points.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PALETTE[draft.colour] ?? PALETTE[0];
      ctx.fill(draftScreenPath(draft, (world) => worldToScreen(camera, world), camera.zoom));
    }
    renderSelection(dpr);
    if (cursors.length > 0) renderCursors(dpr);
  };

  const renderInks = (dpr: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = INK_ALPHA;
    for (const ink of inks) {
      if (ink.points.length === 0) continue;
      ctx.fillStyle = PALETTE[ink.colour] ?? PALETTE[0];
      ctx.fill(draftScreenPath(ink, (world) => worldToScreen(camera, world), camera.zoom));
    }
    ctx.globalAlpha = 1;
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
    publishViewport();
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
    if (inks.some((ink) => changed.has(ink.strokeId))) {
      for (const ink of inks) if (changed.has(ink.strokeId)) landed.add(ink.strokeId);
      inks = inks.filter((ink) => !landed.has(ink.strokeId));
    }
    requestRender();
    reportView();
  };

  const reportPresence = () => {
    if (!awareness) return;
    const next: Presence = {
      peers: peersOf(awareness.getStates(), awareness.clientID).map(
        ({ viewport: _viewport, ...peer }) => peer,
      ),
      following: follow.target,
    };
    if (samePresence(presence, next)) return;
    presence = next;
    onPresence(presence);
  };

  const onAwareness = () => {
    if (!awareness) return;
    const states = awareness.getStates();
    cursors = [...states].flatMap(([clientId, state]) => {
      if (clientId === awareness.clientID) return [];
      const cursor = remoteCursor(clientId, state);
      return cursor ? [cursor] : [];
    });
    const live = [...reader.read(awareness.getStates(), awareness.clientID).values()];
    for (const strokeId of landed) {
      if (!live.some((ink) => ink.strokeId === strokeId)) landed.delete(strokeId);
    }
    for (const ink of live) if (entries.has(ink.strokeId)) landed.add(ink.strokeId);
    inks = live.filter((ink) => !landed.has(ink.strokeId));
    follow.peers(peersOf(states, awareness.clientID));
    reportPresence();
    requestRender();
  };

  const publishViewport = () => {
    if (!awareness) return;
    const { width, height } = size();
    const viewport = viewportOf(camera, width, height);
    if (
      published &&
      published.x === viewport.x &&
      published.y === viewport.y &&
      published.zoom === viewport.zoom
    )
      return;
    const wait = publishedAt + PRESENCE_THROTTLE_MS - performance.now();
    if (wait > 0) {
      if (publishTimer === undefined) {
        publishTimer = setTimeout(() => {
          publishTimer = undefined;
          publishViewport();
        }, wait);
      }
      return;
    }
    published = viewport;
    publishedAt = performance.now();
    awareness.setLocalStateField("presence", {
      colour: presenceColour(awareness.clientID),
      viewport,
    });
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

  const reportView = () => {
    const contentLevels = [...new Set(ordered.map((entry) => entry.stroke.nativeZoom))].sort(
      (a, b) => a - b,
    );
    const level = levelOf(camera.zoom);
    if (
      reported &&
      reported.level === level &&
      reported.contentLevels.join() === contentLevels.join()
    )
      return;
    reported = { level, contentLevels };
    onView(reported);
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
    reportView();
    publishViewport();
  };

  const shareDraft = (next: Draft) => {
    const { objectId, colour, size, nativeZoom, points } = next;
    publisher?.start({ strokeId: objectId, colour, size, nativeZoom });
    publisher?.extend(points);
  };
  const follow = createFollow({
    camera: () => camera,
    size,
    move: moveCamera,
    requestFrame: (step) => requestAnimationFrame(step),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
    onChange: reportPresence,
  });

  const commit = () => {
    if (!draft) return;
    publisher?.finish();
    const stored = finishDraft(draft);
    draft = undefined;
    if (stored) {
      source.commit(stored);
      onCommit();
    }
    publisher?.clear();
  };

  const toLocal = (clientX: number, clientY: number): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const localPoint = (event: PointerEvent | WheelEvent): Point =>
    toLocal(event.clientX, event.clientY);

  const pressureOf = (event: PointerEvent): number =>
    event.pointerType === "pen" ? Math.min(1, Math.max(0, event.pressure)) : 0.5;

  const addPoint = (screen: Point, pressure: number) => {
    if (!draft) return;
    const world = screenToWorld(camera, screen);
    if (draft.points.length >= MAX_POINTS) {
      const next = continueDraft(draft);
      commit();
      draft = next;
      shareDraft(next);
    }
    const point: [number, number, number] = [world.x, world.y, pressure];
    draft.points.push(point);
    publisher?.extend([point]);
  };

  const pointerKind = (event: PointerEvent): PointerKind =>
    event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";

  const apply = (effects: readonly Effect[], event?: PointerEvent) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "StartStroke": {
          const tool = currentTool();
          if (tool.mode === "Select") {
            startDrag(effect.point);
            break;
          }
          if (tool.mode === "Eraser") {
            eraser = undefined;
            eraseTo(effect.point);
            break;
          }
          draft = startDraft(
            effect.secondary ? tool.secondary : tool.primary,
            tool.size,
            camera.zoom,
          );
          shareDraft(draft);
          addPoint(effect.point, event ? pressureOf(event) : 0.5);
          break;
        }
        case "ExtendStroke": {
          if (!event) break;
          const samples = event.getCoalescedEvents?.() ?? [];
          for (const sample of samples.length > 0 ? samples : [event]) {
            if (drag) dragTo(localPoint(sample));
            else if (eraser) eraseTo(localPoint(sample));
            else addPoint(localPoint(sample), pressureOf(sample));
          }
          break;
        }
        case "CommitStroke":
          eraser = undefined;
          drop();
          commit();
          source.history.checkpoint();
          break;
        case "DiscardStroke":
          eraser = undefined;
          drag = undefined;
          draft = undefined;
          publisher?.clear();
          source.history.checkpoint();
          break;
        case "Pan":
          follow.stop();
          moveCamera(pan(camera, effect.dx, effect.dy));
          break;
        case "Pinch":
          follow.stop();
          moveCamera(pinch(camera, effect));
          break;
      }
    }
    if (effects.length > 0) requestRender();
  };

  const stopAnimation = () => {
    cancelAnimationFrame(animation);
    animation = 0;
  };

  const zoomToLevel = (level: number) => {
    follow.stop();
    stopAnimation();
    const from = camera;
    const { width, height } = size();
    const centre = { x: width / 2, y: height / 2 };
    const target = zoomForLevel(level);
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / LEVEL_ANIMATION_MS);
      moveCamera(zoomTo(from, centre, from.zoom * (target / from.zoom) ** easeOut(t)));
      if (t < 1) {
        animation = requestAnimationFrame(step);
        return;
      }
      animation = 0;
      moveCamera(zoomTo(from, centre, target));
    };
    animation = requestAnimationFrame(step);
  };

  const isPointerEvent = (event: Event): event is PointerEvent => "pointerId" in event;

  const onDrag = ({ event, intentional }: { event: Event; intentional: boolean }) => {
    if (!isPointerEvent(event)) return;
    const first = event.type === "pointerdown";
    const cancelled = event.type === "pointercancel";
    const last = cancelled || event.type === "pointerup" || event.type === "lostpointercapture";
    if (first) {
      event.preventDefault();
      stopAnimation();
      dragButton = event.button;
    }
    const effects = input.drag(
      {
        first,
        last,
        cancelled,
        intentional,
        kind: pointerKind(event),
        button: dragButton,
        point: localPoint(event),
        time: event.timeStamp,
      },
      { panTool: currentTool().mode === "Pan", spaceDown },
    );
    apply(effects, event);
    if (!first || event.pointerType !== "touch") return;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => apply(input.tick(performance.now())), PENDING_MS);
  };

  const onPinch = ({
    first,
    last,
    origin,
    da,
  }: {
    first: boolean;
    last: boolean;
    origin: [number, number];
    da: [number, number];
  }) => {
    if (first) {
      stopAnimation();
      follow.stop();
    }
    apply(input.pinch({ first, last, origin: toLocal(origin[0], origin[1]), distance: da[0] }));
  };

  const onWheel = ({ event }: { event: WheelEvent }) => {
    event.preventDefault();
    stopAnimation();
    follow.stop();
    const factor = wheelFactor(event.ctrlKey ? event.deltaY * 3 : event.deltaY, event.deltaMode);
    moveCamera(zoomAt(camera, localPoint(event), factor));
  };

  const onPointerMove = (event: PointerEvent) => shareCursor(localPoint(event));

  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.type === "keydown" && (event.key === "Delete" || event.key === "Backspace")) {
      if (selected === undefined || currentTool().mode !== "Select") return;
      event.preventDefault();
      source.erase(selected);
      source.history.checkpoint();
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

  const gesture = new Gesture(
    canvas,
    { onDrag, onPinch, onWheel },
    {
      eventOptions: { passive: false },
      drag: {
        threshold: DRAG_THRESHOLD_PX,
        triggerAllEvents: true,
        pointer: { buttons: -1, keys: false },
      },
      pinch: { pointer: { touch: true }, pinchOnWheel: false },
    },
  );
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
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
  reportView();

  return {
    zoomToLevel,
    follow(clientId) {
      if (clientId === undefined || clientId === follow.target) {
        follow.stop();
        return;
      }
      stopAnimation();
      follow.start(clientId);
    },
    dispose() {
      clearTimeout(settleTimer);
      clearTimeout(publishTimer);
      follow.dispose();
      clearTimeout(pendingTimer);
      publisher?.clear();
      cancelAnimationFrame(frame);
      stopAnimation();
      gesture.destroy();
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
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
