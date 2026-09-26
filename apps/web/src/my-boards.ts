import {
  MAX_THUMBNAIL_BYTES,
  type MyBoard,
  type MyBoardPatch,
  type MyBoards,
  myBoards,
} from "@stallion/client-sync";
import { type RecentBoard, sortByRecency } from "./recents";
import { syncUrlFor } from "./sync";

export const THUMBNAIL_UPLOAD_MS = 10_000;

export const myBoardsForPage = (): MyBoards | undefined => {
  const url = syncUrlFor(import.meta.env.VITE_SYNC_URL, window.location);
  return url === undefined ? undefined : myBoards(url);
};

const pickThumbnail = (local: RecentBoard, server: MyBoard): string => {
  const [first, second] =
    local.lastOpened > server.lastOpened
      ? [local.thumbnail, server.thumbnail]
      : [server.thumbnail, local.thumbnail];
  return first || second;
};

export const mergeBoards = (
  local: readonly RecentBoard[],
  server: readonly MyBoard[],
): RecentBoard[] => {
  const merged = new Map<string, RecentBoard>(local.map((recent) => [recent.id, recent]));
  for (const remote of server) {
    const mine = merged.get(remote.boardId);
    if (!mine) {
      merged.set(remote.boardId, {
        id: remote.boardId,
        name: remote.name,
        lastOpened: remote.lastOpened,
        thumbnail: remote.thumbnail,
        renamedAt: 0,
      });
      continue;
    }
    const renamedHere = mine.renamedAt > 0;
    merged.set(remote.boardId, {
      id: remote.boardId,
      name: renamedHere ? mine.name : remote.name,
      lastOpened: Math.max(mine.lastOpened, remote.lastOpened),
      thumbnail: pickThumbnail(mine, remote),
      renamedAt: renamedHere ? mine.renamedAt : 0,
    });
  }
  return sortByRecency([...merged.values()]);
};

const uploadable = (thumbnail: string): boolean =>
  thumbnail.length > 0 && thumbnail.length <= MAX_THUMBNAIL_BYTES;

export const patchFor = (
  merged: RecentBoard,
  server: MyBoard | undefined,
): MyBoardPatch | undefined => {
  const patch: MyBoardPatch = {};
  if (!server || merged.name !== server.name) patch.name = merged.name;
  if (!server || merged.lastOpened > server.lastOpened) patch.lastOpened = merged.lastOpened;
  if (merged.thumbnail !== (server?.thumbnail ?? "") && uploadable(merged.thumbnail)) {
    patch.thumbnail = merged.thumbnail;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
};

export type BoardsSync =
  | { state: "Synced"; boards: RecentBoard[] }
  | { state: "Failed"; reason: string; message: string; boards: RecentBoard[] };

export const syncBoards = async (
  api: MyBoards,
  local: readonly RecentBoard[],
): Promise<BoardsSync> => {
  const listed = await api.list();
  if (!listed.ok) return { state: "Failed", ...listed, boards: [...local] };
  const server = new Map(listed.value.map((board) => [board.boardId, board]));
  const merged = mergeBoards(local, listed.value);
  const pushed = await Promise.all(
    merged.map(async (board) => {
      const patch = patchFor(board, server.get(board.id));
      if (!patch) return { board: { ...board, renamedAt: 0 }, failure: undefined };
      const result = await api.upsert(board.id, patch);
      if (!result.ok) return { board, failure: result };
      return { board: { ...board, renamedAt: 0 }, failure: undefined };
    }),
  );
  const boards = pushed.map(({ board }) => board);
  const failure = pushed.find(({ failure }) => failure)?.failure;
  if (failure) return { state: "Failed", ...failure, boards };
  return { state: "Synced", boards };
};

export const thumbnailUploader = (
  send: (thumbnail: string) => void,
  intervalMs: number = THUMBNAIL_UPLOAD_MS,
) => {
  let lastSent = Number.NEGATIVE_INFINITY;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending === undefined) return;
    const thumbnail = pending;
    pending = undefined;
    lastSent = Date.now();
    send(thumbnail);
  };
  return {
    push(thumbnail: string): void {
      if (!uploadable(thumbnail)) return;
      pending = thumbnail;
      const wait = lastSent + intervalMs - Date.now();
      if (wait <= 0) {
        flush();
        return;
      }
      if (timer === undefined) timer = setTimeout(flush, wait);
    },
    flush,
  };
};
