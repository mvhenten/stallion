import "fake-indexeddb/auto";
import { type BBox, place, tileKey } from "@stallion/geometry";
import { decodeMove, type Stroke } from "@stallion/schema";
import { afterEach, expect, test } from "vitest";
import { openBoard, type StallionBoard } from "./index";
import { TestServer } from "./test-server";

const VIEW = { minX: 0, minY: 0, maxX: 1024, maxY: 768 };
const FAR = { minX: 100_000, minY: 100_000, maxX: 101_024, maxY: 100_768 };

const boards: StallionBoard[] = [];
let databases = 0;

const open = (server: TestServer): StallionBoard => {
  const board = openBoard("ws://test", "board", {
    connect: server.connect,
    cache: { name: `sync-test-${databases++}` },
    backoff: { initialMs: 5, maxMs: 20 },
  });
  board.setView(VIEW, 1);
  boards.push(board);
  return board;
};

const stroke = (objectId: string, bbox: BBox = { minX: 10, minY: 10, maxX: 200, maxY: 200 }) => {
  const placed = place(bbox);
  if (!placed.ok) throw new Error("stroke does not fit a tile");
  const object: Stroke = {
    type: "Stroke",
    objectId,
    nativeZoom: 0,
    bbox,
    colour: 0,
    size: "Small",
    points: [[1, 1, 0.5]],
  };
  return { tile: placed.tile, object };
};

const TILE = tileKey(stroke("probe").tile);

const until = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(async () => {
  await Promise.all(boards.splice(0).map((board) => board.close()));
});

test("two clients converge on one tile and share awareness", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");
  await settle();

  alice.put(stroke("alice"));
  bob.put(stroke("bob"));
  alice.awareness.setLocalStateField("cursor", [1, 2]);

  await until(() => alice.objects.size === 2 && bob.objects.size === 2, "convergence");
  expect(server.objectIds(TILE)).toEqual(["alice", "bob"]);
  await until(() => bob.awareness.getStates().has(alice.awareness.clientID), "awareness");
});

test("offline edits replay after reconnect", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");

  server.goOffline();
  await until(() => alice.status !== "Open", "alice offline");
  alice.put(stroke("offline"));
  await settle();
  expect(server.objectIds(TILE)).toEqual([]);

  server.goOnline();
  await until(() => bob.objects.has("offline"), "bob to receive the offline edit");
  expect(server.objectIds(TILE)).toEqual(["offline"]);
});

test("a view change unsubscribes tiles that leave the view", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");
  await settle();
  bob.put(stroke("first"));
  await until(() => alice.objects.has("first"), "alice to see the first stroke");

  alice.setView(FAR, 1);
  expect(alice.objects.has("first")).toBe(false);
  await settle();
  const [aliceSession] = server.sessions;
  expect(aliceSession && server.subscribed(aliceSession, TILE)).toBe(false);

  bob.put(stroke("second"));
  await until(() => server.objectIds(TILE).length === 2, "the server to take the second stroke");
  await settle();
  expect(alice.objects.size).toBe(0);
});

test("a put that changes the tile sends one move frame and keeps the object once", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");
  await settle();
  alice.put(stroke("mover"));
  await until(() => bob.objects.has("mover"), "bob to see the stroke");

  const moved = stroke("mover", { minX: 300, minY: 10, maxX: 490, maxY: 200 });
  const target = tileKey(moved.tile);
  expect(target).not.toBe(TILE);
  alice.put(moved);
  await until(() => server.objectIds(target).length === 1, "the server to take the move");
  await settle();

  const [aliceSession] = server.sessions;
  const moves = (aliceSession?.received ?? []).filter((frame) => frame.kind === "Move");
  expect(moves).toHaveLength(1);
  const decoded = moves[0] && decodeMove(moves[0].payload);
  expect(decoded?.ok && [decoded.value.fromTile, decoded.value.toTile]).toEqual([TILE, target]);
  expect(server.objectIds(TILE)).toEqual([]);
  const landed = bob.objects.get("mover");
  expect(landed && tileKey(landed.tile)).toBe(target);
  expect(bob.objects.size).toBe(1);
});

test("undo reverts only the local stroke after another client's concurrent change", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");
  await settle();

  alice.put(stroke("alice"));
  alice.history.checkpoint();
  bob.put(stroke("bob"));
  await until(() => alice.objects.size === 2 && bob.objects.size === 2, "convergence");
  expect(bob.history.canUndo).toBe(true);

  alice.history.undo();
  await until(() => bob.objects.size === 1, "bob to see the undo");
  expect([...alice.objects.keys()]).toEqual(["bob"]);
  expect(server.objectIds(TILE)).toEqual(["bob"]);
  expect([alice.history.canUndo, alice.history.canRedo]).toEqual([false, true]);

  bob.remove("bob");
  alice.history.redo();
  await until(() => bob.objects.has("alice") && !alice.objects.has("bob"), "redo and erase");
  expect(server.objectIds(TILE)).toEqual(["alice"]);

  bob.put(stroke("late"));
  await until(() => alice.objects.has("late"), "alice to see bob's late stroke");
  bob.remove("alice");
  await until(() => !alice.objects.has("alice"), "alice to see bob erase her stroke");
  alice.history.undo();
  await settle();
  expect(server.objectIds(TILE)).toEqual(["late"]);
  expect([...alice.objects.keys()]).toEqual(["late"]);
  expect(alice.history.canUndo).toBe(false);
});

test("undo of a cross-tile move returns the object to its original tile in one move frame", async () => {
  const server = new TestServer();
  const alice = open(server);
  const bob = open(server);
  await until(() => alice.status === "Open" && bob.status === "Open", "both sockets");
  await settle();
  alice.put(stroke("mover"));
  alice.history.checkpoint();
  await until(() => bob.objects.has("mover"), "bob to see the stroke");

  const moved = stroke("mover", { minX: 300, minY: 10, maxX: 490, maxY: 200 });
  const target = tileKey(moved.tile);
  alice.put(moved);
  alice.history.checkpoint();
  await until(() => server.objectIds(target).length === 1, "the server to take the move");

  alice.history.undo();
  await until(() => server.objectIds(TILE).length === 1, "the server to take the undo");
  await settle();

  const [aliceSession] = server.sessions;
  const moves = (aliceSession?.received ?? []).filter((frame) => frame.kind === "Move");
  expect(moves).toHaveLength(2);
  const undone = moves[1] && decodeMove(moves[1].payload);
  expect(undone?.ok && [undone.value.fromTile, undone.value.toTile]).toEqual([target, TILE]);
  expect(server.objectIds(target)).toEqual([]);
  for (const board of [alice, bob]) {
    const landed = board.objects.get("mover");
    expect(landed && tileKey(landed.tile)).toBe(TILE);
    expect(board.objects.size).toBe(1);
  }
  expect([alice.history.canUndo, alice.history.canRedo]).toEqual([true, true]);
});
