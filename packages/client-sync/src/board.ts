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
  encode,
  encodeFrame,
  encodeMove,
  type FrameKind,
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
import { readSyncMessage, writeUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import { type Connect, connectWebSocket } from "./socket";

export type { Connect, SocketHandlers, SyncSocket } from "./socket";

export type LiveObjects = ReadonlyMap<string, StoredObject> & {
  observe(listener: (changed: ReadonlySet<string>) => void): () => void;
};

export type BoardStatus = "Connecting" | "Open" | "Offline" | "Closed";

export type BoardError = { tileKey: string; reason: string };

export type BoardOptions = {
  connect?: Connect;
  cache?: TileCacheOptions;
  backoff?: { initialMs: number; maxMs: number };
  onError?: (error: BoardError) => void;
  onStatus?: (status: BoardStatus) => void;
};

export type StallionBoard = {
  setView(viewport: BBox, zoom: number): void;
  put(stored: StoredObject): void;
  remove(objectId: string): void;
  readonly objects: LiveObjects;
  readonly awareness: Awareness;
  readonly status: BoardStatus;
  close(): Promise<void>;
};

type TileEntry = { tile: Tile; key: string; doc: Y.Doc; explicit: boolean };

type View = { viewport: BBox; zoom: number; tiles: ViewTiles };

const REMOTE = Symbol("remote");
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

const boardUrl = (url: string, boardId: string): string =>
  `${url.replace(/\/+$/, "")}/api/boards/${encodeURIComponent(boardId)}/ws`;

export function openBoard(url: string, boardId: string, options: BoardOptions = {}): StallionBoard {
  const connect = options.connect ?? connectWebSocket;
  const backoff = options.backoff ?? { initialMs: 500, maxMs: 30_000 };
  const cacheReady = openTileCache(boardId, options.cache);
  const entries = new Map<string, TileEntry>();
  const objectMap = new Map<string, StoredObject>();
  const listeners = new Set<(changed: ReadonlySet<string>) => void>();
  const awareness = new Awareness(new Y.Doc());
  const dirty = new Set<string>();

  let view: View | undefined;
  let socket: ReturnType<Connect> | undefined;
  let status: BoardStatus = "Connecting";
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

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
      if (origin !== REMOTE && origin !== MOVED) sendLocalUpdate(entry, update);
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
    const entry: TileEntry = { tile, key, doc: new Y.Doc(), explicit: false };
    entries.set(key, entry);
    track(entry);
    return entry;
  };

  const drop = (entry: TileEntry): void => {
    entries.delete(entry.key);
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
    entry.doc.destroy();
    notify(changed);
  };

  const sendView = (): void => {
    if (!view || status !== "Open") return;
    const { viewport, zoom } = view;
    send(BOARD_KEY, "View", viewCodec.encode({ ...viewport, zoom }));
  };

  const loadCached = (): void => {
    const target = view;
    if (!target) return;
    withCache(async (cache) => {
      const found = await cache.load([...target.tiles.live, ...target.tiles.snapshot]);
      for (const { tile, state } of found) {
        if (view !== target || !inView(tile)) continue;
        Y.applyUpdate(entryFor(tile).doc, state, CACHED);
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
    const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** attempt);
    attempt++;
    retry = setTimeout(open, delay * (0.5 + Math.random() / 2));
  };

  function open(): void {
    retry = undefined;
    setStatus("Connecting");
    const current = connect(boardUrl(url, boardId), {
      open() {
        if (socket !== current) return;
        attempt = 0;
        setStatus("Open");
        sendView();
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
        scheduleReconnect();
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
    view = { viewport, zoom, tiles: viewTiles(viewport, zoom) };
    for (const entry of [...entries.values()]) {
      if (!inView(entry.tile)) {
        drop(entry);
        continue;
      }
      if (!isLive(entry.tile)) entry.explicit = false;
    }
    sendView();
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

  const move = (
    source: TileEntry,
    target: TileEntry,
    objectId: string,
    bytes: Uint8Array,
  ): void => {
    const fromUpdate = edit(source, (objects) => objects.delete(objectId));
    const toUpdate = edit(target, (objects) => objects.set(objectId, bytes));
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

  const put = (stored: StoredObject): void => {
    const { objectId } = stored.object;
    const bytes = new Uint8Array(encode(stored.object));
    const previous = objectMap.get(objectId);
    const target = entryFor(stored.tile);
    const source = previous && entries.get(tileKey(previous.tile));
    if (source && source !== target) {
      move(source, target, objectId, bytes);
      return;
    }
    target.doc.getMap<Uint8Array>(OBJECTS).set(objectId, bytes);
  };

  const remove = (objectId: string): void => {
    const stored = objectMap.get(objectId);
    if (!stored) return;
    entries.get(tileKey(stored.tile))?.doc.getMap(OBJECTS).delete(objectId);
  };

  const close = async (): Promise<void> => {
    if (status === "Closed") return;
    removeAwarenessStates(awareness, [awareness.clientID], "local");
    setStatus("Closed");
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
    for (const entry of [...entries.values()]) drop(entry);
    awareness.destroy();
    await chain;
    (await cacheReady).close();
  };

  const objects: LiveObjects = Object.assign(objectMap, {
    observe(listener: (changed: ReadonlySet<string>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  open();

  return {
    setView,
    put,
    remove,
    objects,
    awareness,
    get status() {
      return status;
    },
    close,
  };
}
