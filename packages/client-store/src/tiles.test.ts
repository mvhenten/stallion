import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { openTileCache } from "./index";

const everything = [{ level: 0, minTx: 0, minTy: 0, maxTx: 9, maxTy: 9 }];

test("evicts the least recently saved tiles beyond the cap", async () => {
  const cache = await openTileCache("board", { name: "cap-test", cap: 2 });
  for (const tx of [0, 1, 2]) await cache.save({ level: 0, tx, ty: 0 }, new Uint8Array([tx]));
  const kept = await cache.load(everything);
  expect(kept.map(({ tile }) => tile.tx).sort()).toEqual([1, 2]);
  cache.close();
});

test("drains queued updates in order until they are acknowledged", async () => {
  const cache = await openTileCache("board", { name: "queue-test" });
  await cache.enqueue({ level: 0, tx: 0, ty: 0 }, new Uint8Array([1]));
  await cache.enqueue({ level: 0, tx: 1, ty: 0 }, new Uint8Array([2]));
  const queued = await cache.drain();
  expect(queued.map(({ update }) => [...update])).toEqual([[1], [2]]);
  await cache.ack(queued.map(({ id }) => id));
  expect(await cache.drain()).toEqual([]);
  cache.close();
});
