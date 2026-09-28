import "fake-indexeddb/auto";
import type { Stroke } from "@stallion/schema";
import { expect, test } from "vitest";
import { openBoardStore } from "./index";

const tile = { level: 0, tx: 0, ty: 0 };

const stroke = (objectId: string): Stroke => ({
  type: "Stroke",
  objectId,
  nativeZoom: 0,
  bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  colour: 0,
  rgb: 0x1f2328,
  size: "Medium",
  style: "Pen",
  points: [[1, 1, 0.5]],
});

test("remove deletes the row so a query no longer returns it", async () => {
  const store = await openBoardStore("remove-test");
  await store.put({ tile, object: stroke("000000000aaaaaaaaaaaa") });
  await store.put({ tile, object: stroke("000000000bbbbbbbbbbbb") });
  await store.remove("000000000aaaaaaaaaaaa", tile);
  const found = await store.query([{ level: 0, minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 }]);
  expect(found.map(({ object }) => object.objectId)).toEqual(["000000000bbbbbbbbbbbb"]);
  store.close();
});
