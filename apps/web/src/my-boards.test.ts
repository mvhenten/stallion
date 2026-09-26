import {
  type MyBoard,
  type MyBoardPatch,
  type MyBoards,
  myBoards,
  type SocketHandlers,
} from "@stallion/client-sync";
import { Encoder } from "cbor-x";
import { describe, expect, it } from "vitest";
import { followBoards, mergeBoards, syncBoards } from "./my-boards";
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
  removedAt: 0,
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

  it("drops a board removed after this device last opened it", () => {
    const merged = mergeBoards(
      [local("a", 5), local("b", 1)],
      [remote("a", 5, { removedAt: 6 }), remote("b", 1), remote("c", 2, { removedAt: 3 })],
    );
    expect(merged.map((b) => b.id)).toEqual(["b"]);
  });

  it("keeps a board this device opened again after the removal", () => {
    const merged = mergeBoards([local("a", 9)], [remote("a", 5, { removedAt: 6 })]);
    expect(merged.map((b) => [b.id, b.lastOpened])).toEqual([["a", 9]]);
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
      subscribe: () => () => {},
      close: () => {},
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

  it("prunes a removed board from the device list and revives one opened after the removal", async () => {
    const tombstone = remote("a", 5, { removedAt: 6 });
    const pruned = await syncBoards(fakeApi([tombstone]).api, [local("a", 5), local("b", 1)]);
    expect(pruned.boards.map((b) => b.id)).toEqual(["b"]);

    const { api, puts } = fakeApi([tombstone]);
    const revived = await syncBoards(api, [local("a", 7)]);
    expect(revived.boards.map((b) => b.id)).toEqual(["a"]);
    expect(puts).toEqual([["a", { lastOpened: 7 }]]);
  });

  it("keeps the device list when the server cannot be reached", async () => {
    const { api, puts } = fakeApi([], false);
    const boards = [local("a", 1)];
    const synced = await syncBoards(api, boards);
    expect(synced).toMatchObject({ state: "Failed", reason: "NetworkError", boards });
    expect(puts).toEqual([]);
  });
});

describe("followBoards", () => {
  it("merges every pushed list into the device list and hands it to the listener", () => {
    const sockets: { url: string; handlers: SocketHandlers; closed: boolean }[] = [];
    const api = myBoards("wss://stallion.test", {
      connect: (url, handlers) => {
        const socket = { url, handlers, closed: false };
        sockets.push(socket);
        return {
          send: () => {},
          close: () => {
            socket.closed = true;
          },
        };
      },
    });
    let device = [local("a", 5, { name: "mine", renamedAt: 3 }), local("b", 1)];
    const statuses: string[] = [];
    const unfollow = followBoards(
      api,
      (merge) => {
        device = merge(device);
      },
      { onStatus: (status) => statuses.push(status) },
    );

    const [socket] = sockets;
    expect(socket?.url).toBe("wss://stallion.test/api/me/ws");
    socket?.handlers.open();
    const codec = new Encoder({ useRecords: false, mapsAsObjects: true });
    const push = (rows: MyBoard[]) =>
      socket?.handlers.message(codec.encode({ kind: "boards", rows, thumbnails: true }));

    push([remote("a", 2, { name: "theirs" }), remote("c", 1_714_000_000_000, { name: "New" })]);
    expect(device.map((b) => [b.id, b.name])).toEqual([
      ["c", "New"],
      ["a", "mine"],
      ["b", "b"],
    ]);

    push([
      remote("c", 1_714_000_000_000, { name: "Renamed", thumbnail: "data:image/png;base64,AA" }),
    ]);
    expect(device.find((b) => b.id === "c")).toMatchObject({
      name: "Renamed",
      thumbnail: "data:image/png;base64,AA",
    });

    push([remote("c", 1_714_000_000_000, { removedAt: 1_714_000_000_001 })]);
    expect(device.map((b) => b.id)).toEqual(["a", "b"]);

    unfollow();
    expect(socket?.closed).toBe(true);
    expect(statuses).toEqual(["Connecting", "Open"]);
  });
});
