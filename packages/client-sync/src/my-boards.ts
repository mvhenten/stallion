import { Decoder } from "cbor-x";
import { type Fetch, networkRefusal, type Refusal, readJson, refusalOf } from "./pin";
import {
  type Backoff,
  type Connect,
  connectWebSocket,
  DEFAULT_BACKOFF,
  retryDelay,
  type SyncSocket,
} from "./socket";

export const MAX_THUMBNAIL_BYTES = 24 * 1024;

export type MyBoard = {
  boardId: string;
  name: string;
  lastOpened: number;
  thumbnail: string;
  removedAt: number;
};

export type MyBoardPatch = Partial<Omit<MyBoard, "boardId" | "removedAt">>;

export type MyBoardsResult<T> = { ok: true; value: T } | ({ ok: false } & Refusal);

export type MyBoardsStatus = "Connecting" | "Open" | "Offline" | "Closed";

export type MyBoardsListener = (rows: MyBoard[]) => void;

export type SubscribeOptions = {
  onStatus?: (status: MyBoardsStatus) => void;
  onError?: (refusal: Refusal) => void;
};

export type MyBoards = {
  list(): Promise<MyBoardsResult<MyBoard[]>>;
  upsert(boardId: string, patch: MyBoardPatch): Promise<MyBoardsResult<MyBoard>>;
  remove(boardId: string): Promise<MyBoardsResult<undefined>>;
  subscribe(listener: MyBoardsListener, options?: SubscribeOptions): () => void;
  close(): void;
};

export type MyBoardsOptions = { fetch?: Fetch; connect?: Connect; backoff?: Backoff };

export const isMyBoard = (value: unknown): value is MyBoard => {
  if (typeof value !== "object" || value === null) return false;
  const { boardId, name, lastOpened, thumbnail, removedAt } = value as Record<string, unknown>;
  return (
    typeof boardId === "string" &&
    typeof name === "string" &&
    typeof lastOpened === "number" &&
    typeof thumbnail === "string" &&
    typeof removedAt === "number"
  );
};

export const myBoardsEndpoint = (url: string, boardId?: string): string => {
  const origin = url.replace(/\/+$/, "").replace(/^ws(s?):/, "http$1:");
  const list = `${origin}/api/me/boards`;
  return boardId === undefined ? list : `${list}/${encodeURIComponent(boardId)}`;
};

export const myBoardsSocketEndpoint = (url: string): string =>
  `${url.replace(/\/+$/, "").replace(/^http(s?):/, "ws$1:")}/api/me/ws`;

const pushCodec = new Decoder({ useRecords: false, mapsAsObjects: true });

const unixMs = (value: unknown): unknown => (typeof value === "bigint" ? Number(value) : value);

type BoardsPush = { rows: MyBoard[]; thumbnails: boolean };

const boardsPushOf = (bytes: Uint8Array): BoardsPush | undefined => {
  let value: unknown;
  try {
    value = pushCodec.decode(bytes);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, rows, thumbnails } = value as Record<string, unknown>;
  if (kind !== "boards" || !Array.isArray(rows) || typeof thumbnails !== "boolean") {
    return undefined;
  }
  const boards = rows.map((row: unknown) =>
    typeof row === "object" && row !== null
      ? {
          ...row,
          lastOpened: unixMs((row as Record<string, unknown>).lastOpened),
          removedAt: unixMs((row as Record<string, unknown>).removedAt),
        }
      : row,
  );
  if (!boards.every(isMyBoard)) return undefined;
  return { rows: boards, thumbnails };
};

const authRedirect: Refusal = {
  reason: "AuthRedirect",
  message: "the sign-in expired: Access redirected the request to its login page",
};

const malformed = (what: string): Refusal => ({
  reason: "MalformedResponse",
  message: `the server sent a malformed ${what}`,
});

export const myBoards = (url: string, options: MyBoardsOptions = {}): MyBoards => {
  const fetchJson: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const connect = options.connect ?? connectWebSocket;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;

  const call = async (
    boardId: string | undefined,
    init?: RequestInit,
  ): Promise<{ ok: true; body: unknown } | ({ ok: false } & Refusal)> => {
    const response = await fetchJson(myBoardsEndpoint(url, boardId), {
      ...init,
      redirect: "manual",
    }).catch((error: unknown) => ({ error }));
    if ("error" in response) return { ok: false, ...networkRefusal(response.error) };
    if (response.type === "opaqueredirect") return { ok: false, ...authRedirect };
    const body = response.status === 204 ? undefined : await readJson(response);
    if (!response.ok) return { ok: false, ...refusalOf(response, body) };
    return { ok: true, body };
  };

  const list = async (): Promise<MyBoardsResult<MyBoard[]>> => {
    const result = await call(undefined);
    if (!result.ok) return result;
    if (!Array.isArray(result.body) || !result.body.every(isMyBoard)) {
      return { ok: false, ...malformed("board list") };
    }
    return { ok: true, value: result.body };
  };

  type Subscriber = { listener: MyBoardsListener; options: SubscribeOptions };
  const subscribers = new Set<Subscriber>();
  let socket: SyncSocket | undefined;
  let status: MyBoardsStatus = "Closed";
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (next: MyBoardsStatus): void => {
    status = next;
    for (const { options } of subscribers) options.onStatus?.(next);
  };

  const fail = (refusal: Refusal): void => {
    for (const { options } of subscribers) options.onError?.(refusal);
  };

  const deliver = (rows: MyBoard[]): void => {
    for (const { listener } of [...subscribers]) listener(rows);
  };

  const receive = (bytes: Uint8Array): void => {
    const pushed = boardsPushOf(bytes);
    if (!pushed) {
      fail(malformed("board list push"));
      return;
    }
    deliver(pushed.rows);
    if (pushed.thumbnails) return;
    void list().then((listed) => {
      if (!listed.ok) {
        fail(listed);
        return;
      }
      if (socket !== undefined) deliver(listed.value);
    });
  };

  const teardown = (): void => {
    clearTimeout(retry);
    retry = undefined;
    attempt = 0;
    const previous = socket;
    socket = undefined;
    status = "Closed";
    previous?.close();
  };

  function open(): void {
    retry = undefined;
    setStatus("Connecting");
    const current = connect(myBoardsSocketEndpoint(url), {
      open() {
        if (socket !== current) return;
        attempt = 0;
        setStatus("Open");
      },
      message(data) {
        if (socket === current) receive(data);
      },
      close() {
        if (socket !== current) return;
        socket = undefined;
        setStatus("Offline");
        retry = setTimeout(open, retryDelay(backoff, attempt));
        attempt++;
      },
    });
    socket = current;
  }

  return {
    list,
    async upsert(boardId, patch) {
      const result = await call(boardId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!result.ok) return result;
      if (!isMyBoard(result.body)) return { ok: false, ...malformed("board") };
      return { ok: true, value: result.body };
    },
    async remove(boardId) {
      const result = await call(boardId, { method: "DELETE" });
      if (!result.ok) return result;
      return { ok: true, value: undefined };
    },
    subscribe(listener, subscribeOptions = {}) {
      const subscriber: Subscriber = { listener, options: subscribeOptions };
      subscribers.add(subscriber);
      if (socket === undefined && retry === undefined) open();
      else subscribeOptions.onStatus?.(status);
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) teardown();
      };
    },
    close() {
      const closed = [...subscribers];
      subscribers.clear();
      teardown();
      for (const { options } of closed) options.onStatus?.("Closed");
    },
  };
};
