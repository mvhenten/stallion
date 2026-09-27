import {
  openTileCache,
  type StoredObject,
  type TileCache,
  type TileCacheOptions,
} from "@stallion/client-store";
import {
  type BBox,
  type LevelRange,
  type Tile,
  tileKey,
  type ViewTiles,
  viewTiles,
} from "@stallion/geometry";
import {
  BOARD_KEY,
  decode,
  decodeFrame,
  decodeHints,
  encode,
  encodeFrame,
  encodeMove,
  type FrameKind,
  type TileHint,
} from "@stallion/schema";
import { Encoder } from "cbor-x";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import {
  type BoardLock,
  boardEndpoint,
  type Fetch,
  isLockReason,
  localPasses,
  networkRefusal,
  type PassStore,
  type PinResult,
  type PinState,
  passOf,
  pinSetOf,
  readJson,
  refusalOf,
  type SetPinResult,
} from "./pin";
import {
  type Backoff,
  type Connect,
  connectWebSocket,
  DEFAULT_BACKOFF,
  retryDelay,
} from "./socket";

export type { Connect, SocketHandlers, SyncSocket } from "./socket";

export type LiveObjects = ReadonlyMap<string, StoredObject> & {
  observe(listener: (changed: ReadonlySet<string>) => void): () => void;
};

export type LiveHints = {
  readonly current: readonly TileHint[];
  observe(listener: () => void): () => void;
};

export type BoardStatus = "Connecting" | "Open" | "Offline" | "NeedsPin" | "Closed";

export type BoardError = { tileKey: string; reason: string };

export type BoardOptions = {
  localOnly?: boolean;
  connect?: Connect;
  cache?: TileCacheOptions;
  backoff?: Backoff;
  fetch?: Fetch;
  passes?: PassStore;
  onError?: (error: BoardError) => void;
  onStatus?: (status: BoardStatus) => void;
};

export type History = {
  undo(): void;
  redo(): void;
  checkpoint(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  observe(listener: () => void): () => void;
};

export type StallionBoard = {
  setView(viewport: BBox, zoom: number): void;
  put(stored: StoredObject): void;
  remove(objectId: string): void;
  readonly objects: LiveObjects;
  readonly hints: LiveHints;
  readonly history: History;
  readonly awareness: Awareness;
  readonly status: BoardStatus;
  readonly lock: BoardLock | undefined;
  join(pin: string): Promise<PinResult>;
  setPin(pin: string): Promise<SetPinResult>;
  pinState(): Promise<PinState>;
  close(): Promise<void>;
};

type TileEntry = {
  tile: Tile;
  key: string;
  doc: Y.Doc;
  undo: Y.UndoManager;
  explicit: boolean;
};

type Part = { key: string; item: Y.UndoManager["undoStack"][number] };

type Change = {
  objectId: string;
  before: string | undefined;
  after: string | undefined;
  parts: Part[];
};

type View = { viewport: BBox; zoom: number; tiles: ViewTiles };

const REMOTE = Symbol("remote");
const LOCAL = Symbol("local");
const CACHED = Symbol("cached");
const MOVED = Symbol("moved");
const OBJECTS = "objects";

const viewCodec = new Encoder({ useRecords: false, mapsAsObjects: true, variableMapSize: true });

const covers = (range: LevelRange, tile: Tile): boolean =>
  range.level === tile.level &&
  tile.tx >= range.minTx &&
  tile.tx <= range.maxTx &&
  tile.ty >= range.minTy &&
  tile.ty <= range.maxTy;

const parseTileKey = (key: string): Tile | undefined => {
  const [level, tx, ty, ...rest] = key.split(":").map(Number);
  if (level === undefined || tx === undefined || ty === undefined || rest.length > 0) {
    return undefined;
  }
  if (![level, tx, ty].every(Number.isSafeInteger)) return undefined;
  return { level, tx, ty };
};

const syncPayload = (write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
};

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isBoardId = (boardId: string): boolean => BOARD_ID.test(boardId);

export const HANDSHAKE_FAILURES_REPORTED = 3;

export function openBoard(url: string, boardId: string, options: BoardOptions = {}): StallionBoard {
  const connect = options.connect ?? connectWebSocket;
  const fetchJson: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const passes = options.passes ?? localPasses;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const cacheReady = openTileCache(boardId, options.cache);
  const entries = new Map<string, TileEntry>();
  const objectMap = new Map<string, StoredObject>();
  const listeners = new Set<(changed: ReadonlySet<string>) => void>();
  const awareness = new Awareness(new Y.Doc());
  const dirty = new Set<string>();
  const hintListeners = new Set<() => void>();
  let currentHints: readonly TileHint[] = [];

  let view: View | undefined;
  let socket: ReturnType<Connect> | undefined;
  let status: BoardStatus = "Connecting";
  let lock: BoardLock | undefined;
  let attempt = 0;
  let failedHandshakes = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let undoSteps: Change[][] = [];
  let redoSteps: Change[][] = [];
  let openStep: Change[] = [];
  const historyListeners = new Set<() => void>();
  const routed = new Set<Y.UndoManager>();

  const report = (tileKey: string, reason: string): void => {
    if (!options.onError) throw new Error(`Board ${boardId}, tile "${tileKey}": ${reason}`);
    options.onError({ tileKey, reason });
  };

  const setStatus = (next: BoardStatus): void => {
    status = next;
    options.onStatus?.(next);
  };

  const withCache = (task: (cache: TileCache) => Promise<void>, failure: string): void => {
    chain = chain
      .then(() => cacheReady)
      .then(task)
      .catch((error: unknown) => report(BOARD_KEY, `${failure}: ${String(error)}`));
  };

  const send = (tileKey: string, kind: FrameKind, payload: Uint8Array = new Uint8Array()): void => {
    socket?.send(new Uint8Array(encodeFrame({ tileKey, kind, payload: new Uint8Array(payload) })));
  };

  const inView = (tile: Tile): boolean =>
    view !== undefined &&
    [...view.tiles.live, ...view.tiles.snapshot].some((range) => covers(range, tile));

  const isLive = (tile: Tile): boolean =>
    view?.tiles.live.some((range) => covers(range, tile)) ?? false;

  const subscribed = (entry: TileEntry): boolean => entry.explicit || isLive(entry.tile);

  const notify = (changed: ReadonlySet<string>): void => {
    if (changed.size === 0) return;
    for (const listener of listeners) listener(changed);
  };

  const schedulePersist = (key: string): void => {
    const first = dirty.size === 0;
    dirty.add(key);
    if (!first) return;
    withCache(async (cache) => {
      const keys = [...dirty];
      dirty.clear();
      await Promise.all(
        keys.flatMap((key) => {
          const entry = entries.get(key);
          return entry ? [cache.save(entry.tile, Y.encodeStateAsUpdate(entry.doc))] : [];
        }),
      );
    }, "Could not cache tile state");
  };

  const sendLocalUpdate = (entry: TileEntry, update: Uint8Array): void => {
    if (options.localOnly) return;
    if (status !== "Open") {
      withCache((cache) => cache.enqueue(entry.tile, update), "Could not queue an offline edit");
      return;
    }
    if (subscribed(entry)) {
      send(
        entry.key,
        "Sync",
        syncPayload((encoder) => writeUpdate(encoder, update)),
      );
      return;
    }
    entry.explicit = true;
    send(entry.key, "Subscribe");
  };

  const track = (entry: TileEntry): void => {
    const map = entry.doc.getMap<Uint8Array>(OBJECTS);
    map.observe((event) => {
      const changed = new Set<string>();
      for (const objectId of event.keysChanged) {
        const bytes = map.get(objectId);
        if (bytes === undefined) {
          if (ownedBy(objectId, entry)) {
            objectMap.delete(objectId);
            changed.add(objectId);
          }
          continue;
        }
        const decoded = decode(bytes);
        if (!decoded.ok) {
          report(entry.key, `object ${objectId} is invalid: ${decoded.error}`);
          continue;
        }
        objectMap.set(objectId, { tile: entry.tile, object: decoded.value });
        changed.add(objectId);
      }
      notify(changed);
    });
    entry.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === CACHED) return;
      schedulePersist(entry.key);
      if (origin === REMOTE || origin === MOVED) return;
      if (origin instanceof Y.UndoManager && routed.has(origin)) return;
      sendLocalUpdate(entry, update);
    });
  };

  const ownedBy = (objectId: string, entry: TileEntry): boolean => {
    const stored = objectMap.get(objectId);
    return stored !== undefined && tileKey(stored.tile) === entry.key;
  };

  const entryFor = (tile: Tile): TileEntry => {
    const key = tileKey(tile);
    const existing = entries.get(key);
    if (existing) return existing;
    const doc = new Y.Doc();
    const undo = new Y.UndoManager(doc.getMap(OBJECTS), {
      trackedOrigins: new Set([LOCAL, MOVED]),
      captureTimeout: 0,
    });
    const entry: TileEntry = { tile, key, doc, undo, explicit: false };
    entries.set(key, entry);
    track(entry);
    return entry;
  };

  const drop = (entry: TileEntry): void => {
    entries.delete(entry.key);
    forget(entry.key);
    if (entry.explicit) send(entry.key, "Unsubscribe");
    const changed = new Set<string>();
    for (const objectId of entry.doc.getMap(OBJECTS).keys()) {
      if (!ownedBy(objectId, entry)) continue;
      objectMap.delete(objectId);
      changed.add(objectId);
    }
    if (dirty.has(entry.key)) {
      dirty.delete(entry.key);
      const state = Y.encodeStateAsUpdate(entry.doc);
      withCache((cache) => cache.save(entry.tile, state), "Could not cache tile state");
    }
    entry.undo.destroy();
    entry.doc.destroy();
    notify(changed);
  };

  const sendView = (): void => {
    if (!view || status !== "Open") return;
    const { viewport, zoom } = view;
    send(BOARD_KEY, "View", viewCodec.encode({ ...viewport, zoom }));
  };

  // The server's View answer skips tiles that hold no objects, so a tile whose last object was
  // removed elsewhere only reaches a client that still holds it through this step 1.
  const requestSync = (entry: TileEntry): void => {
    if (status !== "Open" || !subscribed(entry)) return;
    send(
      entry.key,
      "Sync",
      syncPayload((encoder) => writeSyncStep1(encoder, entry.doc)),
    );
  };

  const loadCached = (): void => {
    const target = view;
    if (!target) return;
    withCache(async (cache) => {
      const found = await cache.load([...target.tiles.live, ...target.tiles.snapshot]);
      for (const { tile, state } of found) {
        if (view !== target || !inView(tile)) continue;
        const fresh = !entries.has(tileKey(tile));
        const entry = entryFor(tile);
        Y.applyUpdate(entry.doc, state, CACHED);
        if (fresh) requestSync(entry);
      }
    }, "Could not load cached tiles");
  };

  const replayQueue = (): void => {
    withCache(async (cache) => {
      const queued = await cache.drain();
      if (status !== "Open") return;
      for (const { tile, update } of queued) {
        const key = tileKey(tile);
        const entry = entries.get(key);
        const live = entry ? subscribed(entry) : isLive(tile);
        if (!live) send(key, "Subscribe");
        send(
          key,
          "Sync",
          syncPayload((encoder) => writeUpdate(encoder, update)),
        );
        if (live) continue;
        if (entry) entry.explicit = true;
        else send(key, "Unsubscribe");
      }
      await cache.ack(queued.map(({ id }) => id));
    }, "Could not replay offline edits");
  };

  const receive = (bytes: Uint8Array): void => {
    const decoded = decodeFrame(bytes);
    if (!decoded.ok) {
      report(BOARD_KEY, `undecodable frame: ${decoded.error}`);
      return;
    }
    const { tileKey: key, kind, payload } = decoded.value;
    if (kind === "Awareness") {
      applyAwarenessUpdate(awareness, payload, REMOTE);
      return;
    }
    if (kind === "Reject") {
      report(key, new TextDecoder().decode(payload));
      return;
    }
    if (kind === "Hints") {
      const hinted = decodeHints(payload);
      if (!hinted.ok) {
        report(key, `invalid hints: ${hinted.error}`);
        return;
      }
      currentHints = hinted.value;
      for (const listener of hintListeners) listener();
      return;
    }
    const tile = parseTileKey(key);
    if (!tile || (kind !== "Sync" && kind !== "Snapshot")) {
      report(key, `unexpected ${kind} frame`);
      return;
    }
    const entry = entries.get(key) ?? (inView(tile) ? entryFor(tile) : undefined);
    if (!entry) return;
    if (kind === "Snapshot") {
      Y.applyUpdate(entry.doc, payload, REMOTE);
      return;
    }
    const reply = encoding.createEncoder();
    readSyncMessage(decoding.createDecoder(payload), reply, entry.doc, REMOTE);
    if (encoding.length(reply) > 0) send(key, "Sync", encoding.toUint8Array(reply));
  };

  const scheduleReconnect = (): void => {
    retry = setTimeout(open, retryDelay(backoff, attempt));
    attempt++;
  };

  const withPass = (endpoint: string): string => {
    const pass = passes.get(boardId);
    return pass ? `${endpoint}?pass=${encodeURIComponent(pass)}` : endpoint;
  };

  const probeLock = async (): Promise<BoardLock | undefined> => {
    const response = await fetchJson(withPass(boardEndpoint(url, boardId, "ws", "http")));
    if (response.status !== 403) return undefined;
    const refusal = refusalOf(response, await readJson(response));
    return isLockReason(refusal.reason)
      ? { reason: refusal.reason, message: refusal.message }
      : undefined;
  };

  const lockOut = (next: BoardLock): void => {
    if (next.reason === "PassInvalid") passes.remove(boardId);
    lock = next;
    setStatus("NeedsPin");
  };

  const reconnect = (): void => {
    if (status === "Closed" || options.localOnly) return;
    clearTimeout(retry);
    const previous = socket;
    socket = undefined;
    previous?.close();
    attempt = 0;
    open();
  };

  const refused = (target: string): void => {
    if (++failedHandshakes === HANDSHAKE_FAILURES_REPORTED) {
      report(
        BOARD_KEY,
        `the server refused the board connection ${target} ${failedHandshakes} times in a row; still retrying`,
      );
    }
    scheduleReconnect();
  };

  const post = async (endpoint: "join" | "pin", pin: string, pass?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (pass) headers["X-Stallion-Pass"] = pass;
    const response = await fetchJson(boardEndpoint(url, boardId, endpoint, "http"), {
      method: "POST",
      headers,
      body: JSON.stringify({ pin }),
    });
    return { response, body: await readJson(response) };
  };

  const unavailable = (): { ok: false; reason: string; message: string } | undefined => {
    if (options.localOnly) {
      return {
        ok: false,
        reason: "LocalOnly",
        message: "this board is not synced, so it has no PIN",
      };
    }
    if (status === "Closed") return { ok: false, reason: "Closed", message: "the board is closed" };
    return undefined;
  };

  const join = async (pin: string): Promise<PinResult> => {
    const blocked = unavailable();
    if (blocked) return blocked;
    const result = await post("join", pin).catch((error: unknown) => ({ error }));
    if ("error" in result) return { ok: false, ...networkRefusal(result.error) };
    const pass = passOf(result.body);
    if (!result.response.ok || !pass) {
      return { ok: false, ...refusalOf(result.response, result.body) };
    }
    passes.set(boardId, pass);
    lock = undefined;
    reconnect();
    return { ok: true };
  };

  const setPin = async (pin: string): Promise<SetPinResult> => {
    const blocked = unavailable();
    if (blocked) return blocked;
    const result = await post("pin", pin, passes.get(boardId)).catch((error: unknown) => ({
      error,
    }));
    if ("error" in result) return { ok: false, ...networkRefusal(result.error) };
    if (!result.response.ok) return { ok: false, ...refusalOf(result.response, result.body) };
    const pass = passOf(result.body);
    if (pass) passes.set(boardId, pass);
    if (status !== "Open") reconnect();
    return { ok: true, pinSet: pinSetOf(result.body) };
  };

  const pinState = async (): Promise<PinState> => {
    const blocked = unavailable();
    if (blocked) return blocked;
    const response = await fetchJson(boardEndpoint(url, boardId, "pin", "http")).catch(
      (error: unknown) => ({ error }),
    );
    if ("error" in response) return { ok: false, ...networkRefusal(response.error) };
    const body = await readJson(response);
    if (!response.ok) return { ok: false, ...refusalOf(response, body) };
    return { ok: true, pinSet: pinSetOf(body) };
  };

  function open(): void {
    retry = undefined;
    setStatus("Connecting");
    const target = boardEndpoint(url, boardId, "ws", "ws");
    let opened = false;
    const current = connect(withPass(target), {
      open() {
        if (socket !== current) return;
        opened = true;
        attempt = 0;
        failedHandshakes = 0;
        setStatus("Open");
        sendView();
        for (const entry of entries.values()) requestSync(entry);
        if (awareness.getLocalState() !== null) {
          send(BOARD_KEY, "Awareness", encodeAwarenessUpdate(awareness, [awareness.clientID]));
        }
        replayQueue();
      },
      message(data) {
        if (socket === current) receive(data);
      },
      close() {
        if (socket !== current) return;
        socket = undefined;
        for (const entry of entries.values()) entry.explicit = false;
        if (status === "Closed") return;
        setStatus("Offline");
        if (opened) {
          scheduleReconnect();
          return;
        }
        probeLock()
          .catch(() => undefined)
          .then((found) => {
            if (socket !== undefined || retry !== undefined || status !== "Offline") return;
            if (found) lockOut(found);
            else refused(target);
          });
      },
    });
    socket = current;
  }

  awareness.on(
    "update",
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === REMOTE || status !== "Open") return;
      const changed = [...added, ...updated, ...removed];
      send(BOARD_KEY, "Awareness", encodeAwarenessUpdate(awareness, changed));
    },
  );

  const setView = (viewport: BBox, zoom: number): void => {
    const wasLive = new Set([...entries.values()].filter((entry) => isLive(entry.tile)));
    view = { viewport, zoom, tiles: viewTiles(viewport, zoom) };
    for (const entry of [...entries.values()]) {
      if (!inView(entry.tile)) {
        drop(entry);
        continue;
      }
      if (!isLive(entry.tile)) entry.explicit = false;
    }
    sendView();
    for (const entry of entries.values()) if (!wasLive.has(entry)) requestSync(entry);
    loadCached();
  };

  const edit = (
    entry: TileEntry,
    change: (objects: Y.Map<Uint8Array>) => void,
  ): Uint8Array<ArrayBuffer> => {
    let captured: Uint8Array<ArrayBuffer> = new Uint8Array();
    const capture = (update: Uint8Array, origin: unknown): void => {
      if (origin === MOVED) captured = new Uint8Array(update);
    };
    entry.doc.on("update", capture);
    entry.doc.transact(() => change(entry.doc.getMap<Uint8Array>(OBJECTS)), MOVED);
    entry.doc.off("update", capture);
    return captured;
  };

  const ensureSubscribed = (entry: TileEntry): void => {
    if (subscribed(entry)) return;
    entry.explicit = true;
    send(entry.key, "Subscribe");
  };

  const sendMove = (
    source: TileEntry,
    target: TileEntry,
    objectId: string,
    fromUpdate: Uint8Array<ArrayBuffer>,
    toUpdate: Uint8Array<ArrayBuffer>,
  ): void => {
    if (options.localOnly) return;
    if (status !== "Open") {
      withCache(async (cache) => {
        await cache.enqueue(source.tile, fromUpdate);
        await cache.enqueue(target.tile, toUpdate);
      }, "Could not queue an offline move");
      return;
    }
    ensureSubscribed(source);
    ensureSubscribed(target);
    send(
      BOARD_KEY,
      "Move",
      encodeMove({ objectId, fromTile: source.key, toTile: target.key, fromUpdate, toUpdate }),
    );
  };

  const move = (
    source: TileEntry,
    target: TileEntry,
    objectId: string,
    bytes: Uint8Array,
  ): void => {
    const fromUpdate = edit(source, (objects) => objects.delete(objectId));
    const toUpdate = edit(target, (objects) => objects.set(objectId, bytes));
    sendMove(source, target, objectId, fromUpdate, toUpdate);
  };

  const notifyHistory = (): void => {
    for (const listener of historyListeners) listener();
  };

  const locate = (objectId: string): string | undefined => {
    const stored = objectMap.get(objectId);
    return stored && tileKey(stored.tile);
  };

  const record = (objectId: string, before: string | undefined, touched: TileEntry[]): void => {
    const parts = touched.flatMap((entry) => {
      const item = entry.undo.undoStack.pop();
      return item ? [{ key: entry.key, item }] : [];
    });
    if (parts.length === 0) return;
    openStep.push({ objectId, before, after: locate(objectId), parts });
    redoSteps = [];
    notifyHistory();
  };

  const checkpoint = (): void => {
    if (openStep.length === 0) return;
    undoSteps.push(openStep);
    openStep = [];
  };

  const forget = (key: string): void => {
    const keep = (step: Change[]): Change[] =>
      step.filter((change) => change.parts.every((part) => part.key !== key));
    openStep = keep(openStep);
    undoSteps = undoSteps.map(keep).filter((step) => step.length > 0);
    redoSteps = redoSteps.map(keep).filter((step) => step.length > 0);
    notifyHistory();
  };

  const replay = (
    undo: Y.UndoManager,
    part: Part,
    direction: "Undo" | "Redo",
  ): Part | undefined => {
    if (direction === "Undo") {
      undo.undoStack = [part.item];
      undo.undo();
      undo.undoStack = [];
      const item = undo.redoStack.pop();
      return item && { key: part.key, item };
    }
    undo.redoStack = [part.item];
    undo.redo();
    undo.redoStack = [];
    const item = undo.undoStack.pop();
    return item && { key: part.key, item };
  };

  const revert = (change: Change, direction: "Undo" | "Redo"): Change | undefined => {
    const expected = direction === "Undo" ? change.after : change.before;
    if (locate(change.objectId) !== expected) return undefined;
    const ordered = direction === "Undo" ? [...change.parts].reverse() : change.parts;
    const touched = ordered.flatMap((part) => {
      const entry = entries.get(part.key);
      return entry ? [{ entry, part }] : [];
    });
    const updates = new Map<TileEntry, Uint8Array<ArrayBuffer>>();
    const captures = touched.map(({ entry }) => {
      const capture = (update: Uint8Array, origin: unknown): void => {
        if (origin === entry.undo) updates.set(entry, new Uint8Array(update));
      };
      entry.doc.on("update", capture);
      return () => entry.doc.off("update", capture);
    });
    const crossTile = touched.length === 2;
    if (crossTile) for (const { entry } of touched) routed.add(entry.undo);
    const parts = touched.flatMap(({ entry, part }) => {
      const next = replay(entry.undo, part, direction);
      return next ? [next] : [];
    });
    for (const release of captures) release();
    routed.clear();
    const [from, to] = touched;
    if (crossTile && from && to) {
      const fromUpdate = updates.get(from.entry);
      const toUpdate = updates.get(to.entry);
      if (fromUpdate && toUpdate) {
        sendMove(from.entry, to.entry, change.objectId, fromUpdate, toUpdate);
      } else {
        for (const [entry, update] of updates) sendLocalUpdate(entry, update);
      }
    }
    if (parts.length !== change.parts.length) return undefined;
    const restored = direction === "Undo" ? [...parts].reverse() : parts;
    return { ...change, parts: restored };
  };

  const step = (direction: "Undo" | "Redo"): void => {
    checkpoint();
    const from = direction === "Undo" ? undoSteps : redoSteps;
    const into = direction === "Undo" ? redoSteps : undoSteps;
    const changes = from.pop();
    if (!changes) return;
    const ordered = direction === "Undo" ? [...changes].reverse() : changes;
    const applied = ordered.flatMap((change) => {
      const next = revert(change, direction);
      return next ? [next] : [];
    });
    if (applied.length > 0) into.push(direction === "Undo" ? applied.reverse() : applied);
    notifyHistory();
  };

  const history: History = {
    undo: () => step("Undo"),
    redo: () => step("Redo"),
    checkpoint,
    get canUndo() {
      return undoSteps.length > 0 || openStep.length > 0;
    },
    get canRedo() {
      return redoSteps.length > 0;
    },
    observe(listener: () => void): () => void {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },
  };

  const put = (stored: StoredObject): void => {
    const { objectId } = stored.object;
    const bytes = new Uint8Array(encode(stored.object));
    const before = locate(objectId);
    const previous = objectMap.get(objectId);
    const target = entryFor(stored.tile);
    const source = previous && entries.get(tileKey(previous.tile));
    if (source && source !== target) {
      move(source, target, objectId, bytes);
      record(objectId, before, [source, target]);
      return;
    }
    target.doc.transact(() => target.doc.getMap<Uint8Array>(OBJECTS).set(objectId, bytes), LOCAL);
    record(objectId, before, [target]);
  };

  const remove = (objectId: string): void => {
    const stored = objectMap.get(objectId);
    const entry = stored && entries.get(tileKey(stored.tile));
    if (!entry) return;
    const before = locate(objectId);
    entry.doc.transact(() => entry.doc.getMap(OBJECTS).delete(objectId), LOCAL);
    record(objectId, before, [entry]);
  };

  const close = async (): Promise<void> => {
    if (status === "Closed") return;
    removeAwarenessStates(awareness, [awareness.clientID], "local");
    setStatus("Closed");
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
    for (const entry of [...entries.values()]) drop(entry);
    historyListeners.clear();
    hintListeners.clear();
    currentHints = [];
    awareness.destroy();
    await chain;
    (await cacheReady).close();
  };

  const hints: LiveHints = {
    get current() {
      return currentHints;
    },
    observe(listener: () => void): () => void {
      hintListeners.add(listener);
      return () => hintListeners.delete(listener);
    },
  };

  const objects: LiveObjects = Object.assign(objectMap, {
    observe(listener: (changed: ReadonlySet<string>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  if (options.localOnly) setStatus("Offline");
  else if (!isBoardId(boardId)) {
    setStatus("Closed");
    report(
      BOARD_KEY,
      `board id "${boardId}" is not valid: use 1 to 64 letters, digits, "-" or "_"`,
    );
  } else open();

  return {
    setView,
    put,
    remove,
    objects,
    hints,
    history,
    awareness,
    get status() {
      return status;
    },
    get lock() {
      return lock;
    },
    join,
    setPin,
    pinState,
    close,
  };
}
