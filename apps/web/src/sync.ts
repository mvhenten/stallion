import { type BoardStore, openBoardStore, type StoredObject } from "@stallion/client-store";
import type { BoardOptions, BoardStatus, LiveObjects, StallionBoard } from "@stallion/client-sync";
import { type BBox, viewTiles } from "@stallion/geometry";
import { errorMessage } from "./report";

export type Connection = "Connected" | "Reconnecting" | "Offline" | "LocalOnly";

export const CONNECTION_LABEL: Record<Connection, string> = {
  Connected: "Connected",
  Reconnecting: "Reconnecting",
  Offline: "Offline",
  LocalOnly: "Local only: strokes stay in this browser",
};

export const VIEW_DEBOUNCE_MS = 100;

export type Awareness = StallionBoard["awareness"];

export type BoardSource = {
  view(viewport: BBox, zoom: number): void;
  commit(stored: StoredObject): void;
  erase(objectId: string): void;
  readonly objects: LiveObjects;
  readonly awareness: Awareness | undefined;
  close(): Promise<void>;
};

export type OpenBoard = (url: string, boardId: string, options?: BoardOptions) => StallionBoard;

export type SourceOptions = {
  url: string | undefined;
  boardId: string;
  openBoard: OpenBoard;
  onConnection: (connection: Connection) => void;
  onError: (message: string) => void;
};

export const connectionFor = (status: BoardStatus, online: boolean): Connection => {
  if (status === "Open") return "Connected";
  if (!online) return "Offline";
  return status === "Closed" ? "Offline" : "Reconnecting";
};

const liveObjects = (): {
  objects: LiveObjects;
  map: Map<string, StoredObject>;
  notify: (changed: ReadonlySet<string>) => void;
} => {
  const map = new Map<string, StoredObject>();
  const listeners = new Set<(changed: ReadonlySet<string>) => void>();
  const objects: LiveObjects = Object.assign(map, {
    observe(listener: (changed: ReadonlySet<string>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const notify = (changed: ReadonlySet<string>): void => {
    if (changed.size === 0) return;
    for (const listener of listeners) listener(changed);
  };
  return { objects, map, notify };
};

const debounced = (run: (viewport: BBox, zoom: number) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call(viewport: BBox, zoom: number): void {
      clearTimeout(timer);
      timer = setTimeout(() => run(viewport, zoom), VIEW_DEBOUNCE_MS);
    },
    cancel(): void {
      clearTimeout(timer);
    },
  };
};

export function openLocalSource(boardId: string, onError: (message: string) => void): BoardSource {
  const { objects, map, notify } = liveObjects();
  const removed = new Set<string>();
  const storeReady: Promise<BoardStore> = openBoardStore(boardId);
  const fail = (action: string) => (error: unknown) => onError(`${action}: ${errorMessage(error)}`);
  storeReady.catch(fail("Could not open the local board storage"));

  const setView = debounced((viewport, zoom) => {
    const tiles = viewTiles(viewport, zoom);
    storeReady
      .then((store) => store.query([...tiles.live, ...tiles.snapshot]))
      .then((found) => {
        const changed = new Set<string>();
        for (const stored of found) {
          const { objectId } = stored.object;
          if (map.has(objectId) || removed.has(objectId)) continue;
          map.set(objectId, stored);
          changed.add(objectId);
        }
        notify(changed);
      })
      .catch(fail("Could not load the board from local storage"));
  });

  return {
    view: setView.call,
    commit(stored) {
      map.set(stored.object.objectId, stored);
      notify(new Set([stored.object.objectId]));
      storeReady
        .then((store) => store.put(stored))
        .catch(fail("Could not save the stroke to local storage"));
    },
    erase(objectId) {
      const stored = map.get(objectId);
      if (!stored) return;
      removed.add(objectId);
      map.delete(objectId);
      notify(new Set([objectId]));
      storeReady
        .then((store) => store.remove(objectId, stored.tile))
        .catch(fail("Could not delete the stroke from local storage"));
    },
    objects,
    awareness: undefined,
    async close() {
      setView.cancel();
      await storeReady.then(
        (store) => store.close(),
        () => undefined,
      );
    },
  };
}

export function openSyncSource(url: string, options: SourceOptions): BoardSource {
  const online = () => globalThis.navigator?.onLine !== false;
  const board = options.openBoard(url, options.boardId, {
    onStatus: (status) => options.onConnection(connectionFor(status, online())),
    onError: ({ tileKey, reason }) =>
      options.onError(`Sync failed${tileKey ? ` on tile ${tileKey}` : ""}: ${reason}`),
  });
  options.onConnection(connectionFor(board.status, online()));
  const setView = debounced((viewport, zoom) => board.setView(viewport, zoom));
  return {
    view: setView.call,
    commit: (stored) => board.put(stored),
    erase: (objectId) => board.remove(objectId),
    objects: board.objects,
    awareness: board.awareness,
    close() {
      setView.cancel();
      return board.close();
    },
  };
}

export function openSource(options: SourceOptions): BoardSource {
  if (!options.url) {
    options.onConnection("LocalOnly");
    return openLocalSource(options.boardId, options.onError);
  }
  try {
    return openSyncSource(options.url, options);
  } catch (error) {
    options.onError(
      `Could not connect to ${options.url} (${errorMessage(error)}), working local only`,
    );
    options.onConnection("LocalOnly");
    return openLocalSource(options.boardId, options.onError);
  }
}
