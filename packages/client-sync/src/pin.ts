export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PassStore = {
  get(boardId: string): string | undefined;
  set(boardId: string, pass: string): void;
  remove(boardId: string): void;
};

export type LockReason = "PinRequired" | "PassInvalid";

export type Refusal = { reason: string; message: string };

export type BoardLock = { reason: LockReason; message: string };

export type PinResult = { ok: true } | ({ ok: false } & Refusal);

export type PinState = { ok: true; pinSet: boolean } | ({ ok: false } & Refusal);

export type SetPinResult = { ok: true; pinSet: boolean } | ({ ok: false } & Refusal);

const passKey = (boardId: string): string => `stallion:pass:${boardId}`;

const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
};

export const localPasses: PassStore = {
  get(boardId) {
    try {
      return storage()?.getItem(passKey(boardId)) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(boardId, pass) {
    try {
      storage()?.setItem(passKey(boardId), pass);
    } catch {
      return;
    }
  },
  remove(boardId) {
    try {
      storage()?.removeItem(passKey(boardId));
    } catch {
      return;
    }
  },
};

export const memoryPasses = (): PassStore => {
  const passes = new Map<string, string>();
  return {
    get: (boardId) => passes.get(boardId),
    set: (boardId, pass) => {
      passes.set(boardId, pass);
    },
    remove: (boardId) => {
      passes.delete(boardId);
    },
  };
};

export const isLockReason = (reason: string): reason is LockReason =>
  reason === "PinRequired" || reason === "PassInvalid";

export const boardEndpoint = (
  url: string,
  boardId: string,
  endpoint: "ws" | "join" | "pin",
  scheme: "ws" | "http",
): string => {
  const base = url.replace(/\/+$/, "");
  const origin = scheme === "http" ? base.replace(/^ws(s?):/, "http$1:") : base;
  return `${origin}/api/boards/${encodeURIComponent(boardId)}/${endpoint}`;
};

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

export const readJson = async (response: Response): Promise<unknown> =>
  response.json().catch(() => undefined);

export const refusalOf = (response: Response, body: unknown): Refusal => {
  const reason = field(body, "reason");
  const message = field(body, "message");
  return {
    reason: typeof reason === "string" ? reason : `Http${response.status}`,
    message:
      typeof message === "string"
        ? message
        : `the server answered ${response.status} ${response.statusText}`.trim(),
  };
};

export const passOf = (body: unknown): string | undefined => {
  const pass = field(body, "pass");
  return typeof pass === "string" && pass.length > 0 ? pass : undefined;
};

export const pinSetOf = (body: unknown): boolean => field(body, "pinSet") === true;

export const networkRefusal = (error: unknown): Refusal => ({
  reason: "NetworkError",
  message: `could not reach the board server: ${error instanceof Error ? error.message : String(error)}`,
});
