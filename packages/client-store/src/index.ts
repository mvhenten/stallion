import type { LevelRange, Tile } from "@stallion/geometry";
import { decode, encode, type StallionObject } from "@stallion/schema";
import { type DBSchema, type IDBPDatabase, type IDBPObjectStore, openDB } from "idb";

export type StoredObject = { tile: Tile; object: StallionObject };

type TileRecord = {
  boardId: string;
  level: number;
  tx: number;
  ty: number;
  objectId: string;
  bytes: Uint8Array;
};

type TileKey = [string, number, number, number, string];

interface StallionDB extends DBSchema {
  objects: { key: TileKey; value: TileRecord };
}

type ObjectStore = IDBPObjectStore<StallionDB, ["objects"], "objects", "readonly">;

const DB_NAME = "stallion";
const DB_VERSION = 1;

const openStallionDB = (): Promise<IDBPDatabase<StallionDB>> =>
  openDB<StallionDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("objects", { keyPath: ["boardId", "level", "tx", "ty", "objectId"] });
    },
  });

export type BoardStore = {
  put(stored: StoredObject): Promise<void>;
  query(ranges: readonly LevelRange[]): Promise<StoredObject[]>;
  close(): void;
};

export async function openBoardStore(boardId: string): Promise<BoardStore> {
  const db = await openStallionDB();

  const put = async ({ tile, object }: StoredObject): Promise<void> => {
    await db.put("objects", {
      boardId,
      level: tile.level,
      tx: tile.tx,
      ty: tile.ty,
      objectId: object.objectId,
      bytes: encode(object),
    });
  };

  const queryLevel = async (store: ObjectStore, range: LevelRange): Promise<StoredObject[]> => {
    const keys = IDBKeyRange.bound(
      [boardId, range.level, range.minTx],
      [boardId, range.level, range.maxTx, []],
    );
    const records = await store.getAll(keys);
    return records.flatMap((record) => {
      if (record.ty < range.minTy || record.ty > range.maxTy) return [];
      const decoded = decode(record.bytes);
      if (!decoded.ok) {
        throw new TypeError(`Stored object ${record.objectId} is invalid: ${decoded.error}`);
      }
      return [
        { tile: { level: record.level, tx: record.tx, ty: record.ty }, object: decoded.value },
      ];
    });
  };

  const query = async (ranges: readonly LevelRange[]): Promise<StoredObject[]> => {
    const tx = db.transaction("objects", "readonly");
    const results = await Promise.all(ranges.map((range) => queryLevel(tx.store, range)));
    await tx.done;
    return results.flat();
  };

  return { put, query, close: () => db.close() };
}
