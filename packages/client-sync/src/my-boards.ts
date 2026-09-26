import { type Fetch, networkRefusal, type Refusal, readJson, refusalOf } from "./pin";

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

export type MyBoards = {
  list(): Promise<MyBoardsResult<MyBoard[]>>;
  upsert(boardId: string, patch: MyBoardPatch): Promise<MyBoardsResult<MyBoard>>;
  remove(boardId: string): Promise<MyBoardsResult<undefined>>;
};

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

const malformed = (what: string): Refusal => ({
  reason: "MalformedResponse",
  message: `the server sent a malformed ${what}`,
});

export const myBoards = (url: string, options: { fetch?: Fetch } = {}): MyBoards => {
  const fetchJson: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const call = async (
    boardId: string | undefined,
    init?: RequestInit,
  ): Promise<{ ok: true; body: unknown } | ({ ok: false } & Refusal)> => {
    const response = await fetchJson(myBoardsEndpoint(url, boardId), init).catch(
      (error: unknown) => ({ error }),
    );
    if ("error" in response) return { ok: false, ...networkRefusal(response.error) };
    const body = response.status === 204 ? undefined : await readJson(response);
    if (!response.ok) return { ok: false, ...refusalOf(response, body) };
    return { ok: true, body };
  };

  return {
    async list() {
      const result = await call(undefined);
      if (!result.ok) return result;
      if (!Array.isArray(result.body) || !result.body.every(isMyBoard)) {
        return { ok: false, ...malformed("board list") };
      }
      return { ok: true, value: result.body };
    },
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
  };
};
