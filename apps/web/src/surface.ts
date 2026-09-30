import type { StoredObject } from "@stallion/client-store";
import { createInkPublisher, createInkReader, type LiveInk } from "@stallion/client-sync";
import {
  type BBox,
  bboxCentre,
  cull,
  dedupeMarkers,
  MARKER_ALPHA,
  MARKER_PX,
  type Marker,
  type Point,
  type Tile,
  tileBounds,
} from "@stallion/geometry";
import {
  nearestColour,
  nearestSize,
  rgbHex,
  rgbOf,
  type Shape,
  type ShapeFill,
  type ShapeKind,
  type Sticky,
  type Stroke,
  type StrokeStyle,
  type Text,
  type TextStyle,
  textStyleOf,
} from "@stallion/schema";
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
import { clipPolyline, exceeds, inflate, strokeRuns, type Vec } from "./clip";
import { hitsFrame, hitsShape, hitsStroke } from "./eraser";
import { createFollow } from "./follow";
import { createInput, DRAG_THRESHOLD_PX, type Effect, PENDING_MS, type PointerKind } from "./input";
import { easeOut, LEVEL_ANIMATION_MS, levelOf, zoomForLevel } from "./level";
import {
  type LevelObjects,
  nearestFirst,
  objectLabel,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  previewFit,
} from "./level-objects";
import { type Candidate, isLocatingMode, isSmall, locate, rings, screenRadius } from "./locator";
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
  finishShape,
  paintShape,
  type ShapeDraft,
  scaleShape,
  shapeLook,
  shapeScreenInk,
  shapeWorldPoints,
  startShape,
  translateShape,
} from "./shape";
import {
  paintSticky,
  restyleSticky,
  scaleSticky,
  startSticky,
  stickyLines,
  stickyMetrics,
  translateSticky,
  withText,
} from "./sticky";
import {
  continueDraft,
  type Draft,
  draftScreenInk,
  finishDraft,
  MAX_POINTS,
  paintInk,
  type Scale,
  type StrokeFrame,
  type StrokeInk,
  scaleStroke,
  startDraft,
  strokeExtent,
  strokeFrame,
  strokeFrameInk,
  translateStroke,
} from "./stroke";
import type { DrawingSource } from "./sync";
import {
  paintText,
  restyleText,
  scaleText,
  startText,
  textInkBox,
  textLines,
  translateText,
  withTextContent,
} from "./text";
import type { TextChange } from "./text-change";
import {
  type Face,
  faceOf,
  LINE_HEIGHT,
  type MeasureAt,
  MIN_TEXT_PX,
  measureText,
  worldFont,
} from "./wrap";

export type ToolMode = "Pencil" | "Shape" | "Sticky" | "Text" | "Pan" | "Eraser" | "Select";

export type Tool = {
  width: number;
  style: StrokeStyle;
  primary: number;
  secondary: number;
  shape: ShapeKind;
  fill: ShapeFill;
  mode: ToolMode;
};

type Entry =
  | { type: "Stroke"; tile: Tile; object: Stroke; frame: StrokeFrame; ink: StrokeInk }
  | { type: "Shape"; tile: Tile; object: Shape; start: Point; end: Point }
  | { type: "Sticky"; tile: Tile; object: Sticky; lines: string[] }
  | { type: "Text"; tile: Tile; object: Text; lines: string[]; ink: BBox };

const isWritable = (entry: Entry | undefined): entry is Entry & { object: Sticky | Text } =>
  entry?.type === "Sticky" || entry?.type === "Text";

const hits = (entry: Entry, world: Point, zoom: number): boolean => {
  if (entry.type === "Text") return hitsFrame({ bbox: entry.ink }, world, zoom);
  if (entry.type === "Sticky") return hitsFrame(entry.object, world, zoom);
  return entry.type === "Stroke"
    ? hitsStroke(entry.tile, entry.object, world, zoom)
    : hitsShape(entry.tile, entry.object, world, zoom);
};

const translate = (
  entry: Entry,
  dx: number,
  dy: number,
  measureAt: MeasureAt,
): StoredObject | undefined => {
  if (entry.type === "Sticky") return translateSticky(entry.object, dx, dy);
  if (entry.type === "Text") return translateText(entry.tile, entry.object, dx, dy, measureAt);
  return entry.type === "Stroke"
    ? translateStroke(entry.tile, entry.object, dx, dy)
    : translateShape(entry.tile, entry.object, dx, dy);
};

type Drag = { objectId: string; from: Point; dx: number; dy: number; href: string | undefined };

const extent = (entry: Entry): BBox => {
  if (entry.type === "Stroke") return strokeExtent(entry.tile, entry.object);
  if (isWritable(entry)) return entry.object.bbox;
  const { start, end } = entry;
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
};

const scale = (entry: Entry, by: Scale, measureAt: MeasureAt): StoredObject | undefined => {
  if (entry.type === "Sticky") return scaleSticky(entry.object, by, measureAt);
  if (entry.type === "Text") return scaleText(entry.object, by, measureAt);
  return entry.type === "Stroke"
    ? scaleStroke(entry.tile, entry.object, by)
    : scaleShape(entry.tile, entry.object, by);
};

const colourOf = (object: Entry["object"]): number => {
  if (object.type === "Sticky") return object.background;
  return object.type === "Text" ? object.rgb : rgbOf(object);
};

type Corner = { right: boolean; bottom: boolean };

const CORNERS: readonly Corner[] = [
  { right: false, bottom: false },
  { right: true, bottom: false },
  { right: true, bottom: true },
  { right: false, bottom: true },
];

const cornerOf = (box: BBox, { right, bottom }: Corner): Point => ({
  x: right ? box.maxX : box.minX,
  y: bottom ? box.maxY : box.minY,
});

type Resize = {
  objectId: string;
  anchor: Point;
  corner: Point;
  from: Point;
  result: StoredObject | undefined;
  preview: Entry | undefined;
};

const SELECTION_PAD_PX = 4;

const paintPreview = (ctx: CanvasRenderingContext2D, entry: Entry, dpr: number): void => {
  const fit = previewFit(extent(entry));
  const view: Camera = { x: fit.x, y: fit.y, zoom: fit.scale };
  const toScreen = (world: Point): Point => worldToScreen(view, world);
  const bounds: BBox = { minX: 0, minY: 0, maxX: PREVIEW_WIDTH, maxY: PREVIEW_HEIGHT };
  const colour = rgbHex(colourOf(entry.object));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  if (entry.type === "Sticky") {
    const { bbox } = entry.object;
    paintSticky(
      ctx,
      entry.object,
      entry.lines,
      {
        ...toScreen({ x: bbox.minX, y: bbox.minY }),
        width: (bbox.maxX - bbox.minX) * view.zoom,
        height: (bbox.maxY - bbox.minY) * view.zoom,
      },
      view.zoom,
      true,
      bounds,
      false,
    );
    return;
  }
  if (entry.type === "Text") {
    const { bbox } = entry.object;
    paintText(ctx, entry.object, entry.lines, toScreen({ x: bbox.minX, y: bbox.minY }), view.zoom);
    return;
  }
  if (entry.type === "Shape") {
    paintShape(
      ctx,
      shapeScreenInk(shapeLook(entry.object), entry.start, entry.end, toScreen, view.zoom),
      colour,
    );
    return;
  }
  const { origin } = entry.frame;
  const inkScale = entry.frame.scale * view.zoom * dpr;
  ctx.setTransform(
    inkScale,
    0,
    0,
    inkScale,
    (origin.x - view.x) * view.zoom * dpr,
    (origin.y - view.y) * view.zoom * dpr,
  );
  paintInk(ctx, entry.ink, colour);
};

export const HANDLE_HIT_PX = 44;

const HANDLE_PX = 12;

const SELECTION = "#0090ff";

const SELECTION_DASH = [4, 4];

export const LINK_GLYPH_PX = 18;

export const LINK_HIT_PX = 44;

const LINK_INSET_PX = 14;

export const HINT_GREY = "#8c8c8c";

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

export type TextEdit = {
  objectId: string;
  label: string;
  text: string;
  ink: string;
  background: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontPx: number;
  padPx: number;
  lineHeightPx: number;
  face: Face;
  underline: boolean;
};

export type ScreenBox = { left: number; top: number; right: number; bottom: number };

export type TextTarget = {
  objectId: string;
  kind: "Sticky" | "Text";
  style: TextStyle;
  href: string | undefined;
  width: number;
  sizePx: number;
  rect: ScreenBox;
  editing: boolean;
};

const targetKey = (target: TextTarget | undefined): string => JSON.stringify(target ?? null);

const sameEdit = (a: TextEdit | undefined, b: TextEdit | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.objectId === b.objectId &&
    a.ink === b.ink &&
    a.background === b.background &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.fontPx === b.fontPx &&
    a.padPx === b.padPx &&
    a.lineHeightPx === b.lineHeightPx &&
    a.face.font === b.face.font &&
    a.face.bold === b.face.bold &&
    a.face.italic === b.face.italic &&
    a.underline === b.underline);

export type Surface = {
  zoomToLevel(level: number): void;
  follow(clientId: number | undefined): void;
  editText(text: string): void;
  levelObjects(level: number): LevelObjects;
  preview(objectId: string): string | undefined;
  jumpTo(objectId: string): void;
  highlight(objectId: string | undefined): void;
  finishEdit(): void;
  styleText(change: TextChange): void;
  panBy(dx: number, dy: number): void;
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
  onEdit: (edit: TextEdit | undefined) => void = () => undefined,
  onTarget: (target: TextTarget | undefined) => void = () => undefined,
): Surface {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D canvas context.");
  const ctx = context;

  const entries = new Map<string, Entry>();
  let ordered: Entry[] = [];
  let camera = loadCamera(boardId);
  let draft: Draft | undefined;
  let shapeDraft: ShapeDraft | undefined;
  let eraser: Point | undefined;
  let selected: string | undefined;
  let drag: Drag | undefined;
  let resizing: Resize | undefined;
  let press: { mode: "Sticky" | "Text"; point: Point; secondary: boolean } | undefined;
  let editing: { objectId: string; text: string; pending: Entry | undefined } | undefined;
  let reportedEdit: TextEdit | undefined;
  let reportedTarget = targetKey(undefined);
  let liveFit: { source: Sticky | Text; text: string; result: Sticky | Text } | undefined;
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
  let hover: Point | undefined;
  let candidates: Candidate[] = [];
  let rippleSince: number | undefined;
  let previewed: string | undefined;
  const previews = new WeakMap<Entry, string>();

  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });

  const screenBounds = (): BBox => ({
    minX: 0,
    minY: 0,
    maxX: canvas.clientWidth,
    maxY: canvas.clientHeight,
  });

  const onScreen = (bbox: BBox, { dx, dy }: { dx: number; dy: number }): BBox => {
    const topLeft = worldToScreen(camera, { x: bbox.minX + dx, y: bbox.minY + dy });
    const bottomRight = worldToScreen(camera, { x: bbox.maxX + dx, y: bbox.maxY + dy });
    return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
  };

  const render = () => {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    const screen = screenBounds();
    const device: BBox = { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height };
    const view = viewBounds(camera, width, height);
    const toDevice = (world: Point): Point => ({
      x: (world.x - camera.x) * camera.zoom * dpr,
      y: (world.y - camera.y) * camera.zoom * dpr,
    });
    const markers: Marker[] = [];
    const locating = isLocatingMode(currentTool().mode);
    candidates = [];
    for (const original of ordered) {
      const resized =
        resizing?.objectId === original.object.objectId ? resizing.preview : undefined;
      const entry = resized ?? original;
      const dragged = drag?.objectId === entry.object.objectId ? drag : undefined;
      const culled = dragged || resized ? "Draw" : cull(entry.object.bbox, view, camera.zoom);
      if (culled === "Skip") continue;
      const colour = rgbHex(colourOf(entry.object));
      const radius =
        locating && !dragged && !resized && screenRadius(entry.object.bbox, camera.zoom);
      if (radius && isSmall(radius)) {
        const centre = worldToScreen(camera, bboxCentre(entry.object.bbox));
        candidates.push({ ...centre, radius, style: colour });
      }
      if (culled === "Marker") {
        markers.push({ ...toDevice(bboxCentre(entry.object.bbox)), style: colour });
        continue;
      }
      const offset = dragged ?? { dx: 0, dy: 0 };
      const oversized = exceeds(onScreen(entry.object.bbox, offset), screen);
      if (entry.type === "Sticky") {
        const { bbox } = entry.object;
        const topLeft = worldToScreen(camera, {
          x: bbox.minX + offset.dx,
          y: bbox.minY + offset.dy,
        });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintSticky(
          ctx,
          entry.object,
          entry.lines,
          {
            ...topLeft,
            width: (bbox.maxX - bbox.minX) * camera.zoom,
            height: (bbox.maxY - bbox.minY) * camera.zoom,
          },
          camera.zoom,
          editing?.objectId !== entry.object.objectId,
          screen,
          oversized,
        );
        continue;
      }
      if (entry.type === "Text") {
        if (editing?.objectId === entry.object.objectId) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintText(
          ctx,
          entry.object,
          entry.lines,
          worldToScreen(camera, {
            x: entry.object.bbox.minX + offset.dx,
            y: entry.object.bbox.minY + offset.dy,
          }),
          camera.zoom,
        );
        continue;
      }
      if (entry.type === "Shape") {
        const shift = (world: Point): Point =>
          worldToScreen(camera, { x: world.x + offset.dx, y: world.y + offset.dy });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintShape(
          ctx,
          shapeScreenInk(shapeLook(entry.object), entry.start, entry.end, shift, camera.zoom),
          colour,
          1,
          oversized ? screen : undefined,
        );
        continue;
      }
      const { origin } = entry.frame;
      const scale = entry.frame.scale * camera.zoom * dpr;
      const x = (origin.x + offset.dx - camera.x) * camera.zoom * dpr;
      const y = (origin.y + offset.dy - camera.y) * camera.zoom * dpr;
      if (oversized) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        paintInk(ctx, entry.ink, colour, 1, { scale, x, y, bounds: device });
        continue;
      }
      ctx.setTransform(scale, 0, 0, scale, x, y);
      paintInk(ctx, entry.ink, colour);
    }
    renderMarkers(
      source.hints.current.map((hint) => ({
        ...toDevice(bboxCentre(tileBounds(hint))),
        style: HINT_GREY,
      })),
    );
    renderMarkers(markers);
    if (inks.length > 0) renderInks(dpr);
    if (draft && draft.points.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintInk(
        ctx,
        draftScreenInk(draft, (world) => worldToScreen(camera, world), camera.zoom),
        rgbHex(draft.rgb),
      );
    }
    if (shapeDraft) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintShape(
        ctx,
        shapeScreenInk(
          shapeDraft,
          shapeDraft.start,
          shapeDraft.end,
          (world) => worldToScreen(camera, world),
          camera.zoom,
        ),
        rgbHex(shapeDraft.rgb),
      );
    }
    renderLinks(dpr);
    renderSelection(dpr);
    renderLocators(dpr);
    renderPreviewed(dpr);
    if (cursors.length > 0) renderCursors(dpr);
    ctx.restore();
    reportEdit();
    reportTarget();
  };

  const liveObject = (entry: Entry & { object: Sticky | Text }): Sticky | Text => {
    const { object } = entry;
    if (object.fit !== "Auto" || editing?.objectId !== object.objectId) return object;
    const { text } = editing;
    if (text === object.text) return object;
    if (liveFit?.source === object && liveFit.text === text) return liveFit.result;
    const stored =
      object.type === "Sticky"
        ? withText(object, text, measureAt)
        : withTextContent(entry.tile, object, text, measureAt);
    const next = stored?.object;
    const result = next?.type === "Sticky" || next?.type === "Text" ? next : object;
    liveFit = { source: object, text, result };
    return result;
  };

  const targetEntry = (): Entry | undefined => {
    if (!editing) return selectedEntry();
    if (resizing?.objectId === editing.objectId && resizing.preview) return resizing.preview;
    return entries.get(editing.objectId) ?? editing.pending;
  };

  const targetOf = (): TextTarget | undefined => {
    const entry = targetEntry();
    if (!isWritable(entry)) return undefined;
    const object = liveObject(entry);
    const offset = drag?.objectId === object.objectId ? drag : { dx: 0, dy: 0 };
    const box = onScreen(object.bbox, offset);
    const rect = canvas.getBoundingClientRect();
    return {
      objectId: object.objectId,
      kind: object.type,
      style: textStyleOf(object),
      href: object.href,
      width: object.width,
      sizePx: worldFont(object) * camera.zoom,
      rect: {
        left: rect.left + box.minX,
        top: rect.top + box.minY,
        right: rect.left + box.maxX,
        bottom: rect.top + box.maxY,
      },
      editing: editing?.objectId === object.objectId,
    };
  };

  const reportTarget = () => {
    const next = targetOf();
    const key = targetKey(next);
    if (key === reportedTarget) return;
    reportedTarget = key;
    onTarget(next);
  };

  const linkGlyph = (entry: Entry): Point | undefined => {
    if (!isWritable(entry) || entry.object.href === undefined) return undefined;
    if (editing?.objectId === entry.object.objectId) return undefined;
    const font = worldFont(entry.object) * camera.zoom;
    if (font < MIN_TEXT_PX) return undefined;
    const offset = drag?.objectId === entry.object.objectId ? drag : { dx: 0, dy: 0 };
    if (entry.type === "Sticky") {
      const box = onScreen(entry.object.bbox, offset);
      if (box.maxX - box.minX < LINK_INSET_PX * 3) return undefined;
      return { x: box.maxX - LINK_INSET_PX, y: box.minY + LINK_INSET_PX };
    }
    if (entry.type !== "Text") return undefined;
    const ink = onScreen(entry.ink, offset);
    return { x: ink.maxX + LINK_INSET_PX, y: ink.minY + (font * LINE_HEIGHT) / 2 };
  };

  const linkAt = (screen: Point): Entry | undefined =>
    ordered.findLast((entry) => {
      const glyph = linkGlyph(entry);
      return (
        glyph !== undefined &&
        Math.abs(screen.x - glyph.x) <= LINK_HIT_PX / 2 &&
        Math.abs(screen.y - glyph.y) <= LINK_HIT_PX / 2
      );
    });

  const renderLinks = (dpr: number) => {
    const screen = inflate(screenBounds(), LINK_GLYPH_PX);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const original of ordered) {
      const entry =
        resizing?.objectId === original.object.objectId && resizing.preview
          ? resizing.preview
          : original;
      const glyph = linkGlyph(entry);
      if (!glyph) continue;
      if (
        glyph.x < screen.minX ||
        glyph.x > screen.maxX ||
        glyph.y < screen.minY ||
        glyph.y > screen.maxY
      )
        continue;
      ctx.setTransform(dpr, 0, 0, dpr, glyph.x * dpr, glyph.y * dpr);
      ctx.fillStyle = SELECTION;
      ctx.beginPath();
      ctx.arc(0, 0, LINK_GLYPH_PX / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 1.75;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(-3.5, 3.5);
      ctx.lineTo(3.5, -3.5);
      ctx.moveTo(-1.5, -3.5);
      ctx.lineTo(3.5, -3.5);
      ctx.lineTo(3.5, 1.5);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const editOf = (): TextEdit | undefined => {
    if (!editing) return undefined;
    const original = entries.get(editing.objectId) ?? editing.pending;
    const entry =
      resizing?.objectId === editing.objectId && resizing.preview ? resizing.preview : original;
    if (!isWritable(entry)) return undefined;
    const { dx, dy } = drag?.objectId === editing.objectId ? drag : { dx: 0, dy: 0 };
    const object = liveObject(entry);
    const { bbox } = object;
    const rect = canvas.getBoundingClientRect();
    const topLeft = worldToScreen(camera, { x: bbox.minX + dx, y: bbox.minY + dy });
    const placement = {
      objectId: object.objectId,
      text: editing.text,
      ink: rgbHex(object.rgb),
      left: rect.left + topLeft.x,
      top: rect.top + topLeft.y,
      width: (bbox.maxX - bbox.minX) * camera.zoom,
      height: (bbox.maxY - bbox.minY) * camera.zoom,
      face: faceOf(object),
      underline: object.href !== undefined,
    };
    if (object.type === "Text") {
      const font = worldFont(object) * camera.zoom;
      return {
        ...placement,
        label: "Text",
        background: "transparent",
        fontPx: font,
        padPx: 0,
        lineHeightPx: font * LINE_HEIGHT,
      };
    }
    const metrics = stickyMetrics(object);
    return {
      ...placement,
      label: "Note text",
      background: rgbHex(object.background),
      fontPx: metrics.font * camera.zoom,
      padPx: metrics.pad * camera.zoom,
      lineHeightPx: metrics.lineHeight * camera.zoom,
    };
  };

  const reportEdit = () => {
    const next = editOf();
    if (sameEdit(reportedEdit, next)) return;
    reportedEdit = next;
    onEdit(next);
  };

  const startEdit = (objectId: string, pending?: Entry) => {
    if (editing?.objectId === objectId) return;
    const entry = entries.get(objectId);
    editing = { objectId, text: isWritable(entry) ? entry.object.text : "", pending };
    selected = pending ? undefined : objectId;
    reportEdit();
    requestRender();
  };

  const commitEdit = (stored: StoredObject | undefined) => {
    if (!stored) return;
    source.commit(stored);
    source.history.checkpoint();
    onCommit();
  };

  const finishText = (entry: Entry | undefined, text: string) => {
    if (entry?.type !== "Text" || text === entry.object.text) return;
    if (text.trim() === "") {
      if (!entries.has(entry.object.objectId)) return;
      source.erase(entry.object.objectId);
      source.history.checkpoint();
      onCommit();
      return;
    }
    commitEdit(withTextContent(entry.tile, entry.object, text, measureAt));
  };

  const finishEdit = () => {
    if (!editing) return;
    const { objectId, text, pending } = editing;
    editing = undefined;
    const entry = entries.get(objectId) ?? pending;
    if (entry?.type === "Sticky" && text !== entry.object.text) {
      commitEdit(withText(entry.object, text, measureAt));
    }
    finishText(entry, text);
    if (pending) selected = objectId;
    reportEdit();
    requestRender();
  };

  const placeText = (at: Point, secondary: boolean) => {
    const hit = pick(at);
    if (hit?.type === "Text") {
      startEdit(hit.object.objectId);
      return;
    }
    const tool = currentTool();
    const stored = startText(
      secondary ? tool.secondary : tool.primary,
      camera.zoom,
      screenToWorld(camera, at),
      measureAt,
    );
    const pending = stored && entryOf(stored);
    if (pending) startEdit(pending.object.objectId, pending);
  };

  const placeSticky = (press: { point: Point; secondary: boolean }) => {
    const hit = pick(press.point);
    if (hit?.type === "Sticky") {
      startEdit(hit.object.objectId);
      return;
    }
    const tool = currentTool();
    const stored = startSticky(
      press.secondary ? tool.secondary : tool.primary,
      camera.zoom,
      screenToWorld(camera, press.point),
    );
    if (!stored) return;
    source.commit(stored);
    source.history.checkpoint();
    onCommit();
    startEdit(stored.object.objectId);
  };

  const renderMarkers = (markers: Iterable<Marker>) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = MARKER_ALPHA;
    for (const marker of dedupeMarkers(markers)) {
      ctx.fillStyle = marker.style;
      ctx.fillRect(marker.x, marker.y, MARKER_PX, MARKER_PX);
    }
    ctx.globalAlpha = 1;
  };

  const renderInks = (dpr: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const ink of inks) {
      if (ink.points.length === 0) continue;
      paintInk(
        ctx,
        draftScreenInk(ink, (world) => worldToScreen(camera, world), camera.zoom),
        rgbHex(ink.rgb),
        INK_ALPHA,
        { scale: 1, x: 0, y: 0, bounds: screenBounds() },
      );
    }
  };

  const selectedEntry = (): Entry | undefined => {
    if (selected === undefined) return undefined;
    if (resizing?.objectId === selected && resizing.preview) return resizing.preview;
    return entries.get(selected);
  };

  const selectionCorners = (entry: Entry): Point[] => {
    const { dx, dy } = drag ?? { dx: 0, dy: 0 };
    const { bbox } = entry.object;
    const topLeft = worldToScreen(camera, { x: bbox.minX + dx, y: bbox.minY + dy });
    const bottomRight = worldToScreen(camera, { x: bbox.maxX + dx, y: bbox.maxY + dy });
    const box = {
      minX: topLeft.x - SELECTION_PAD_PX,
      minY: topLeft.y - SELECTION_PAD_PX,
      maxX: bottomRight.x + SELECTION_PAD_PX,
      maxY: bottomRight.y + SELECTION_PAD_PX,
    };
    return CORNERS.map((corner) => cornerOf(box, corner));
  };

  const handleAt = (screen: Point): Corner | undefined => {
    const entry = selectedEntry();
    if (!entry) return undefined;
    let best: { corner: Corner; distance: number } | undefined;
    selectionCorners(entry).forEach((point, index) => {
      const dx = Math.abs(screen.x - point.x);
      const dy = Math.abs(screen.y - point.y);
      const corner = CORNERS[index];
      if (!corner || dx > HANDLE_HIT_PX / 2 || dy > HANDLE_HIT_PX / 2) return;
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) best = { corner, distance };
    });
    return best?.corner;
  };

  const strokeBox = (box: BBox, dash: number[]) => {
    const screen = screenBounds();
    const { minX, minY, maxX, maxY } = box;
    if (!exceeds(box, screen)) {
      ctx.setLineDash(dash);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.setLineDash([]);
      return;
    }
    const corners: Vec[] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    strokeRuns(ctx, clipPolyline(corners, true, inflate(screen, 2)), dash);
  };

  const strokeInk = (ink: BBox) => strokeBox(onScreen(ink, drag ?? { dx: 0, dy: 0 }), []);

  const renderSelection = (dpr: number) => {
    const entry = selectedEntry();
    if (!entry) return;
    const [topLeft, , bottomRight] = selectionCorners(entry);
    if (!topLeft || !bottomRight) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = 1;
    strokeBox(
      { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y },
      SELECTION_DASH,
    );
    if (entry.type === "Text") strokeInk(entry.ink);
    if (drag) return;
    ctx.fillStyle = PAPER;
    ctx.lineWidth = 1.5;
    const reach = inflate(screenBounds(), HANDLE_PX);
    for (const { x, y } of selectionCorners(entry)) {
      if (x < reach.minX || x > reach.maxX || y < reach.minY || y > reach.maxY) continue;
      ctx.fillRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      ctx.strokeRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    }
  };

  const liveLocators = () =>
    hover && !drag && !resizing && isLocatingMode(currentTool().mode)
      ? locate(candidates, hover)
      : [];

  const renderLocators = (dpr: number) => {
    const live = liveLocators();
    if (live.length === 0) {
      rippleSince = undefined;
      return;
    }
    const now = performance.now();
    rippleSince ??= now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    for (const locator of live) {
      ctx.strokeStyle = locator.style;
      for (const ring of rings(locator, now - rippleSince)) {
        if (ring.alpha <= 0) continue;
        ctx.globalAlpha = ring.alpha;
        ctx.beginPath();
        ctx.arc(locator.x, locator.y, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    requestRender();
  };

  const hoverAt = (point: Point | undefined) => {
    const rippling = rippleSince !== undefined;
    hover = point;
    if (rippling || liveLocators().length > 0) requestRender();
  };

  const renderPreviewed = (dpr: number) => {
    const entry = previewed === undefined ? undefined : entries.get(previewed);
    if (!entry) return;
    const box = inflate(onScreen(entry.object.bbox, { dx: 0, dy: 0 }), SELECTION_PAD_PX);
    const screen = screenBounds();
    if (
      box.maxX < screen.minX ||
      box.minX > screen.maxX ||
      box.maxY < screen.minY ||
      box.minY > screen.maxY
    )
      return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = 1;
    strokeBox(box, SELECTION_DASH);
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

  const measureAt: MeasureAt = (px, face) => measureText(ctx, px, face);

  const styleText = (change: TextChange) => {
    const objectId = editing?.objectId ?? selected;
    if (objectId === undefined) return;
    const pending =
      editing?.objectId === objectId && !entries.has(objectId) ? editing.pending : undefined;
    const entry = entries.get(objectId) ?? pending;
    if (!isWritable(entry)) return;
    const stored =
      entry.type === "Sticky"
        ? restyleSticky(entry.object, change, measureAt)
        : restyleText(entry.tile, entry.object, change, measureAt);
    if (!stored) return;
    if (pending && editing) {
      editing = { ...editing, pending: entryOf(stored) };
      requestRender();
      return;
    }
    commitEdit(stored);
  };

  const entryOf = ({ tile, object }: StoredObject): Entry | undefined => {
    if (object.type === "Sticky") {
      return { type: "Sticky", tile, object, lines: stickyLines(object, measureAt) };
    }
    if (object.type === "Text") {
      const lines = textLines(tile, object, measureAt);
      return { type: "Text", tile, object, lines, ink: textInkBox(object, lines, measureAt) };
    }
    if (object.type === "Shape") {
      return { type: "Shape", tile, object, ...shapeWorldPoints(tile, object) };
    }
    if (object.type !== "Stroke") return undefined;
    const frame = strokeFrame(tile, object);
    return { type: "Stroke", tile, object, frame, ink: strokeFrameInk(object, frame) };
  };

  const add = (stored: StoredObject) => {
    const entry = entryOf(stored);
    if (!entry) return;
    const { object } = entry;
    const previous = entries.get(object.objectId);
    entries.set(object.objectId, entry);
    const rest = previous ? ordered.filter((other) => other !== previous) : ordered;
    const index = rest.findIndex((other) => other.object.objectId > object.objectId);
    ordered =
      index === -1 ? [...rest, entry] : [...rest.slice(0, index), entry, ...rest.slice(index)];
  };

  const eraseAt = (screen: Point) => {
    const { width, height } = size();
    const view = viewBounds(camera, width, height);
    const world = screenToWorld(camera, screen);
    for (const entry of ordered) {
      if (cull(entry.object.bbox, view, camera.zoom) !== "Draw") continue;
      if (hits(entry, world, camera.zoom)) source.erase(entry.object.objectId);
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
        cull(entry.object.bbox, view, camera.zoom) === "Draw" && hits(entry, world, camera.zoom),
    );
  };

  const startDrag = (screen: Point) => {
    const link = linkAt(screen);
    const hit = link ?? pick(screen);
    selected = hit?.object.objectId;
    drag = hit && {
      objectId: hit.object.objectId,
      from: screenToWorld(camera, screen),
      dx: 0,
      dy: 0,
      href: link && isWritable(link) ? link.object.href : undefined,
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
    if (!moved || !entry) return;
    const tapped = Math.hypot(moved.dx, moved.dy) * camera.zoom < DRAG_THRESHOLD_PX;
    if (tapped && moved.href !== undefined) {
      window.open(moved.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (isWritable(entry) && tapped) {
      startEdit(entry.object.objectId);
      return;
    }
    if (moved.dx === 0 && moved.dy === 0) return;
    const stored = translate(entry, moved.dx, moved.dy, measureAt);
    if (stored) source.commit(stored);
  };

  const startResize = (screen: Point) => {
    const entry = selected === undefined ? undefined : entries.get(selected);
    const handle = handleAt(screen);
    if (!entry || !handle) return;
    const box = extent(entry);
    resizing = {
      objectId: entry.object.objectId,
      anchor: cornerOf(box, { right: !handle.right, bottom: !handle.bottom }),
      corner: cornerOf(box, handle),
      from: screenToWorld(camera, screen),
      result: undefined,
      preview: undefined,
    };
  };

  const resizeTo = (screen: Point) => {
    const entry = resizing && entries.get(resizing.objectId);
    if (!resizing || !entry) return;
    const { anchor, corner, from } = resizing;
    const world = screenToWorld(camera, screen);
    const factor = (moved: number, span: number): number => (span === 0 ? 1 : moved / span);
    const by: Scale = {
      anchor,
      sx: factor(corner.x + world.x - from.x - anchor.x, corner.x - anchor.x),
      sy: factor(corner.y + world.y - from.y - anchor.y, corner.y - anchor.y),
    };
    const result = by.sx === 1 && by.sy === 1 ? undefined : scale(entry, by, measureAt);
    resizing = { ...resizing, result, preview: result && entryOf(result) };
  };

  const finishResize = () => {
    const result = resizing?.result;
    resizing = undefined;
    if (result) source.commit(result);
  };

  const discard = (objectId: string) => {
    if (selected === objectId && !source.objects.has(objectId)) selected = undefined;
    if (editing?.objectId === objectId && !source.objects.has(objectId)) editing = undefined;
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
    const contentLevels = [...new Set(ordered.map((entry) => entry.object.nativeZoom))].sort(
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
    const { objectId, rgb, width, style, nativeZoom, points } = next;
    publisher?.start({
      strokeId: objectId,
      colour: nearestColour(rgb),
      rgb,
      size: nearestSize(width),
      width,
      style,
      nativeZoom,
    });
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

  const commitShape = () => {
    if (!shapeDraft) return;
    const stored = finishShape(shapeDraft);
    shapeDraft = undefined;
    if (!stored) return;
    source.commit(stored);
    onCommit();
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
          finishEdit();
          const tool = currentTool();
          if (tool.mode !== "Select") selected = undefined;
          if (tool.mode === "Sticky" || tool.mode === "Text") {
            press = { mode: tool.mode, point: effect.point, secondary: effect.secondary };
            break;
          }
          if (tool.mode === "Select") {
            startDrag(effect.point);
            break;
          }
          if (tool.mode === "Eraser") {
            eraser = undefined;
            eraseTo(effect.point);
            break;
          }
          if (tool.mode === "Shape") {
            shapeDraft = startShape(
              tool.shape,
              tool.fill,
              effect.secondary ? tool.secondary : tool.primary,
              tool.width,
              tool.style,
              camera.zoom,
              screenToWorld(camera, effect.point),
            );
            break;
          }
          draft = startDraft(
            effect.secondary ? tool.secondary : tool.primary,
            tool.width,
            tool.style,
            camera.zoom,
          );
          shareDraft(draft);
          addPoint(effect.point, event ? pressureOf(event) : 0.5);
          break;
        }
        case "StartResize":
          startResize(effect.point);
          break;
        case "ExtendStroke": {
          if (!event) break;
          if (resizing) {
            resizeTo(localPoint(event));
            break;
          }
          const samples = event.getCoalescedEvents?.() ?? [];
          for (const sample of samples.length > 0 ? samples : [event]) {
            if (drag) dragTo(localPoint(sample));
            else if (eraser) eraseTo(localPoint(sample));
            else if (shapeDraft) shapeDraft.end = screenToWorld(camera, localPoint(sample));
            else addPoint(localPoint(sample), pressureOf(sample));
          }
          break;
        }
        case "CommitStroke": {
          eraser = undefined;
          const tapped = press;
          press = undefined;
          if (tapped?.mode === "Sticky") placeSticky(tapped);
          if (tapped?.mode === "Text") placeText(tapped.point, tapped.secondary);
          drop();
          finishResize();
          commit();
          commitShape();
          source.history.checkpoint();
          break;
        }
        case "DiscardStroke":
          eraser = undefined;
          press = undefined;
          drag = undefined;
          resizing = undefined;
          draft = undefined;
          shapeDraft = undefined;
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

  const levelObjects = (level: number): LevelObjects => {
    const { width, height } = size();
    const centre = screenToWorld(camera, { x: width / 2, y: height / 2 });
    const { items, more } = nearestFirst(
      ordered
        .filter((entry) => entry.object.nativeZoom === level)
        .map((entry) => ({ objectId: entry.object.objectId, bbox: entry.object.bbox, entry })),
      centre,
    );
    return {
      items: items.map(({ objectId, bbox, entry }) => ({
        objectId,
        bbox,
        label: objectLabel(entry.object),
      })),
      more,
    };
  };

  const preview = (objectId: string): string | undefined => {
    const entry = entries.get(objectId);
    if (!entry) return undefined;
    const cached = previews.get(entry);
    if (cached) return cached;
    const dpr = window.devicePixelRatio || 1;
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.round(PREVIEW_WIDTH * dpr);
    offscreen.height = Math.round(PREVIEW_HEIGHT * dpr);
    const previewCtx = offscreen.getContext("2d");
    if (!previewCtx) return undefined;
    paintPreview(previewCtx, entry, dpr);
    const url = offscreen.toDataURL("image/png");
    previews.set(entry, url);
    return url;
  };

  const jumpTo = (objectId: string) => {
    const entry = entries.get(objectId);
    if (!entry) return;
    follow.stop();
    stopAnimation();
    previewed = undefined;
    const from = camera;
    const { width, height } = size();
    const start = screenToWorld(from, { x: width / 2, y: height / 2 });
    const end = bboxCentre(entry.object.bbox);
    const target = zoomForLevel(entry.object.nativeZoom);
    const at = (t: number): Camera => {
      const zoom = from.zoom * (target / from.zoom) ** t;
      return {
        x: start.x + (end.x - start.x) * t - width / 2 / zoom,
        y: start.y + (end.y - start.y) * t - height / 2 / zoom,
        zoom,
      };
    };
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / LEVEL_ANIMATION_MS);
      moveCamera(at(easeOut(t)));
      if (t < 1) {
        animation = requestAnimationFrame(step);
        return;
      }
      animation = 0;
      moveCamera(at(1));
    };
    animation = requestAnimationFrame(step);
  };

  const highlight = (objectId: string | undefined) => {
    if (previewed === objectId) return;
    previewed = objectId;
    requestRender();
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
      {
        panTool: currentTool().mode === "Pan",
        spaceDown,
        onHandle:
          first && currentTool().mode === "Select" && handleAt(localPoint(event)) !== undefined,
      },
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

  const onPointerMove = (event: PointerEvent) => {
    const point = localPoint(event);
    shareCursor(point);
    hoverAt(event.pointerType !== "touch" && event.buttons === 0 ? point : undefined);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
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

  const onPointerLeave = () => {
    shareCursor(undefined);
    hoverAt(undefined);
  };

  const preventDefault = (event: Event) => event.preventDefault();

  const unobserve = source.objects.observe(onObjects);
  const unobserveHints = source.hints.observe(requestRender);
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
    levelObjects,
    preview,
    jumpTo,
    highlight,
    follow(clientId) {
      if (clientId === undefined || clientId === follow.target) {
        follow.stop();
        return;
      }
      stopAnimation();
      follow.start(clientId);
    },
    editText(text) {
      if (!editing) return;
      editing = { ...editing, text };
      const entry = entries.get(editing.objectId) ?? editing.pending;
      if (isWritable(entry) && entry.object.fit === "Auto") requestRender();
    },
    finishEdit,
    styleText,
    panBy(dx, dy) {
      follow.stop();
      moveCamera(pan(camera, dx, dy));
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
      unobserveHints();
      awareness?.off("change", onAwareness);
      saveCamera(boardId, camera);
    },
  };
}
