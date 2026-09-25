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

type TileStateRecord = {
  boardId: string;
  level: number;
  tx: number;
  ty: number;
  state: Uint8Array;
  usedAt: number;
};

type PendingRecord = {
  boardId: string;
  level: number;
  tx: number;
  ty: number;
  update: Uint8Array;
};

interface StallionDB extends DBSchema {
  objects: { key: TileKey; value: TileRecord };
  tiles: {
    key: [string, number, number, number];
    value: TileStateRecord;
    indexes: { usedAt: number };
  };
  pending: { key: number; value: PendingRecord; indexes: { boardId: string } };
}

type ObjectStore = IDBPObjectStore<StallionDB, ["objects"], "objects", "readonly">;

const DB_NAME = "stallion";
const DB_VERSION = 2;

const openStallionDB = (name = DB_NAME): Promise<IDBPDatabase<StallionDB>> =>
  openDB<StallionDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("objects", { keyPath: ["boardId", "level", "tx", "ty", "objectId"] });
      }
      if (oldVersion < 2) {
        db.createObjectStore("tiles", { keyPath: ["boardId", "level", "tx", "ty"] }).createIndex(
          "usedAt",
          "usedAt",
        );
        db.createObjectStore("pending", { autoIncrement: true }).createIndex("boardId", "boardId");
      }
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

export type TileState = { tile: Tile; state: Uint8Array };

export type QueuedUpdate = { id: number; tile: Tile; update: Uint8Array };

export type TileCache = {
  load(ranges: readonly LevelRange[]): Promise<TileState[]>;
  save(tile: Tile, state: Uint8Array): Promise<void>;
  enqueue(tile: Tile, update: Uint8Array): Promise<void>;
  drain(): Promise<QueuedUpdate[]>;
  ack(ids: readonly number[]): Promise<void>;
  close(): void;
};

export type TileCacheOptions = { name?: string; cap?: number };

export const DEFAULT_TILE_CAP = 2048;

let lastUsedAt = 0;
const nextUsedAt = (): number => {
  lastUsedAt = Math.max(Date.now(), lastUsedAt + 1);
  return lastUsedAt;
};

const inRange = (range: LevelRange, ty: number): boolean => ty >= range.minTy && ty <= range.maxTy;

export async function openTileCache(
  boardId: string,
  { name = DB_NAME, cap = DEFAULT_TILE_CAP }: TileCacheOptions = {},
): Promise<TileCache> {
  const db = await openStallionDB(name);

  const load = async (ranges: readonly LevelRange[]): Promise<TileState[]> => {
    const tx = db.transaction("tiles", "readonly");
    const results = await Promise.all(
      ranges.map(async (range) => {
        const records = await tx.store.getAll(
          IDBKeyRange.bound(
            [boardId, range.level, range.minTx, Number.NEGATIVE_INFINITY],
            [boardId, range.level, range.maxTx, Number.POSITIVE_INFINITY],
          ),
        );
        return records
          .filter((record) => inRange(range, record.ty))
          .map((record) => ({
            tile: { level: record.level, tx: record.tx, ty: record.ty },
            state: record.state,
          }));
      }),
    );
    await tx.done;
    return results.flat();
  };

  const save = async (tile: Tile, state: Uint8Array): Promise<void> => {
    const tx = db.transaction("tiles", "readwrite");
    await tx.store.put({ boardId, ...tile, state, usedAt: nextUsedAt() });
    let excess = (await tx.store.count()) - cap;
    let cursor = excess > 0 ? await tx.store.index("usedAt").openCursor() : null;
    while (cursor && excess > 0) {
      await cursor.delete();
      excess--;
      cursor = await cursor.continue();
    }
    await tx.done;
  };

  const enqueue = async (tile: Tile, update: Uint8Array): Promise<void> => {
    await db.add("pending", { boardId, ...tile, update });
  };

  const drain = async (): Promise<QueuedUpdate[]> => {
    const queued: QueuedUpdate[] = [];
    const tx = db.transaction("pending", "readonly");
    let cursor = await tx.store.index("boardId").openCursor(boardId);
    while (cursor) {
      const { level, tx: column, ty, update } = cursor.value;
      queued.push({ id: cursor.primaryKey, tile: { level, tx: column, ty }, update });
      cursor = await cursor.continue();
    }
    await tx.done;
    return queued;
  };

  const ack = async (ids: readonly number[]): Promise<void> => {
    const tx = db.transaction("pending", "readwrite");
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  };

  return { load, save, enqueue, drain, ack, close: () => db.close() };
}
