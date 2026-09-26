import type { StoredObject } from "@stallion/client-store";
import type {
  BoardLock,
  BoardOptions,
  BoardStatus,
  History,
  LiveObjects,
  PinResult,
  PinState,
  SetPinResult,
  StallionBoard,
} from "@stallion/client-sync";
import type { BBox } from "@stallion/geometry";
import { errorMessage } from "./report";

export type Connection = "Connected" | "Reconnecting" | "Offline" | "Locked" | "LocalOnly";

export const CONNECTION_LABEL: Record<Connection, string> = {
  Connected: "Connected",
  Reconnecting: "Reconnecting",
  Offline: "Offline",
  Locked: "Locked: enter the board PIN to join",
  LocalOnly: "Local only: strokes stay in this browser",
};

export const VIEW_DEBOUNCE_MS = 100;

export type Awareness = StallionBoard["awareness"];

export type DrawingSource = {
  view(viewport: BBox, zoom: number): void;
  commit(stored: StoredObject): void;
  erase(objectId: string): void;
  readonly objects: LiveObjects;
  readonly history: History;
  readonly awareness: Awareness | undefined;
  close(): Promise<void>;
};

export type BoardSource = DrawingSource & {
  readonly lock: BoardLock | undefined;
  join(pin: string): Promise<PinResult>;
  setPin(pin: string): Promise<SetPinResult>;
  pinState(): Promise<PinState>;
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
  if (status === "NeedsPin") return "Locked";
  if (!online) return "Offline";
  return status === "Closed" ? "Offline" : "Reconnecting";
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

export function openLocalSource(options: SourceOptions): BoardSource {
  const board = options.openBoard("", options.boardId, {
    localOnly: true,
    cache: { cap: Number.POSITIVE_INFINITY },
    onError: ({ reason }) => options.onError(reason),
  });
  const setView = debounced((viewport, zoom) => board.setView(viewport, zoom));
  return {
    view: setView.call,
    commit: (stored) => board.put(stored),
    erase: (objectId) => board.remove(objectId),
    objects: board.objects,
    history: board.history,
    awareness: undefined,
    get lock() {
      return board.lock;
    },
    join: (pin) => board.join(pin),
    setPin: (pin) => board.setPin(pin),
    pinState: () => board.pinState(),
    close() {
      setView.cancel();
      return board.close();
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
    history: board.history,
    awareness: board.awareness,
    get lock() {
      return board.lock;
    },
    join: (pin) => board.join(pin),
    setPin: (pin) => board.setPin(pin),
    pinState: () => board.pinState(),
    close() {
      setView.cancel();
      return board.close();
    },
  };
}

export function openSource(options: SourceOptions): BoardSource {
  if (!options.url) {
    options.onConnection("LocalOnly");
    return openLocalSource(options);
  }
  try {
    return openSyncSource(options.url, options);
  } catch (error) {
    options.onError(
      `Could not connect to ${options.url} (${errorMessage(error)}), working local only`,
    );
    options.onConnection("LocalOnly");
    return openLocalSource(options);
  }
}

const PRIVATE_HOST = [
  /^localhost$/,
  /\.localhost$/,
  /\.ts\.net$/,
  /^\[?::1\]?$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export const syncUrlFor = (
  configured: string | undefined,
  location: Pick<Location, "protocol" | "host" | "hostname">,
): string | undefined => {
  if (configured) return configured;
  if (PRIVATE_HOST.some((pattern) => pattern.test(location.hostname))) return undefined;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
};
