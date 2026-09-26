import type { MyBoard, MyBoardPatch, MyBoards } from "@stallion/client-sync";
import { describe, expect, it } from "vitest";
import { mergeBoards, syncBoards } from "./my-boards";
import type { RecentBoard } from "./recents";

const local = (id: string, lastOpened: number, extra: Partial<RecentBoard> = {}): RecentBoard => ({
  id,
  name: id,
  lastOpened,
  thumbnail: "",
  renamedAt: 0,
  ...extra,
});

const remote = (boardId: string, lastOpened: number, extra: Partial<MyBoard> = {}): MyBoard => ({
  boardId,
  name: boardId,
  lastOpened,
  thumbnail: "",
  ...extra,
});

describe("mergeBoards", () => {
  it("keeps the newest lastOpened per board and sorts newest first", () => {
    const merged = mergeBoards(
      [local("a", 5), local("b", 1)],
      [remote("a", 2), remote("b", 9), remote("c", 3)],
    );
    expect(merged.map((b) => [b.id, b.lastOpened])).toEqual([
      ["b", 9],
      ["a", 5],
      ["c", 3],
    ]);
  });

  it("takes the server name unless this device renamed the board since the last sync", () => {
    const merged = mergeBoards(
      [local("a", 1, { name: "old" }), local("b", 1, { name: "mine", renamedAt: 7 })],
      [remote("a", 1, { name: "Sketchbook" }), remote("b", 1, { name: "theirs" })],
    );
    expect(merged.find((b) => b.id === "a")?.name).toBe("Sketchbook");
    expect(merged.find((b) => b.id === "b")).toMatchObject({ name: "mine", renamedAt: 7 });
  });

  it("takes the thumbnail from the newer side, falling back to whichever has one", () => {
    const merged = mergeBoards(
      [local("a", 5, { thumbnail: "local-a" }), local("b", 1, { thumbnail: "local-b" })],
      [remote("a", 2, { thumbnail: "server-a" }), remote("b", 3)],
    );
    expect(merged.find((b) => b.id === "a")?.thumbnail).toBe("local-a");
    expect(merged.find((b) => b.id === "b")?.thumbnail).toBe("local-b");
  });
});

describe("syncBoards", () => {
  const fakeApi = (server: MyBoard[], online = true) => {
    const puts: [string, MyBoardPatch][] = [];
    const api: MyBoards = {
      list: async () =>
        online
          ? { ok: true, value: server }
          : { ok: false, reason: "NetworkError", message: "offline" },
      upsert: async (boardId, patch) => {
        puts.push([boardId, patch]);
        return { ok: true, value: remote(boardId, 0) };
      },
      remove: async () => ({ ok: true, value: undefined }),
    };
    return { api, puts };
  };

  it("writes what the server lacks back to it and clears the pending rename", async () => {
    const { api, puts } = fakeApi([remote("a", 4, { name: "server" })]);
    const synced = await syncBoards(api, [local("a", 2, { name: "renamed", renamedAt: 9 })]);
    expect(synced).toMatchObject({ state: "Synced" });
    expect(synced.boards).toEqual([local("a", 4, { name: "renamed" })]);
    expect(puts).toEqual([["a", { name: "renamed" }]]);
  });

  it("keeps the device list when the server cannot be reached", async () => {
    const { api, puts } = fakeApi([], false);
    const boards = [local("a", 1)];
    const synced = await syncBoards(api, boards);
    expect(synced).toMatchObject({ state: "Failed", reason: "NetworkError", boards });
    expect(puts).toEqual([]);
  });
});
