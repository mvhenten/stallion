import type { StoredObject } from "@stallion/client-store";
import type { StallionBoard } from "@stallion/client-sync";
import { expect, test, vi } from "vitest";
import { type OpenBoard, openSource } from "./sync";

const stored: StoredObject = {
  tile: { level: 0, tx: 0, ty: 0 },
  object: {
    type: "Stroke",
    objectId: "000000000aaaaaaaaaaaa",
    nativeZoom: 0,
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    colour: 0,
    size: "Medium",
    points: [[1, 1, 0.5]],
  },
};

test("a stroke commit goes through put and an erase through remove", () => {
  const put = vi.fn();
  const remove = vi.fn();
  const openBoard: OpenBoard = (url, boardId) => {
    expect([url, boardId]).toEqual(["ws://sync.test", "board"]);
    return { put, remove, status: "Connecting" } as unknown as StallionBoard;
  };
  const connections: string[] = [];
  const source = openSource({
    url: "ws://sync.test",
    boardId: "board",
    openBoard,
    onConnection: (connection) => connections.push(connection),
    onError: (message) => {
      throw new Error(message);
    },
  });

  source.commit(stored);
  source.erase(stored.object.objectId);

  expect(put).toHaveBeenCalledWith(stored);
  expect(remove).toHaveBeenCalledWith(stored.object.objectId);
  expect(connections).toEqual(["Reconnecting"]);
});
