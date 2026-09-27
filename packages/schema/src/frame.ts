import { Encoder } from "cbor-x";
import { z } from "zod";

export const frameKind = z.enum([
  "Subscribe",
  "Unsubscribe",
  "Sync",
  "Awareness",
  "Reject",
  "View",
  "Snapshot",
  "Move",
  "Hints",
]);

export const frame = z.strictObject({
  tileKey: z.string(),
  kind: frameKind,
  payload: z.instanceof(Uint8Array),
});

export type FrameKind = z.infer<typeof frameKind>;
export type Frame = z.infer<typeof frame>;

export const BOARD_KEY = "";

export type FrameResult = { ok: true; value: Frame } | { ok: false; error: string };

const cbor = new Encoder({
  useRecords: false,
  mapsAsObjects: true,
  variableMapSize: true,
  tagUint8Array: false,
});

export const encodeFrame = (value: Frame): Uint8Array =>
  cbor.encode({ tileKey: value.tileKey, kind: value.kind, payload: value.payload });

export const decodeFrame = (bytes: Uint8Array): FrameResult => {
  const parsed = frame.safeParse(cbor.decode(bytes));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
};

export const move = z.strictObject({
  objectId: z.string(),
  fromTile: z.string(),
  toTile: z.string(),
  fromUpdate: z.instanceof(Uint8Array),
  toUpdate: z.instanceof(Uint8Array),
});

export type Move = z.infer<typeof move>;

export type MoveResult = { ok: true; value: Move } | { ok: false; error: string };

export const encodeMove = (value: Move): Uint8Array =>
  cbor.encode({
    objectId: value.objectId,
    fromTile: value.fromTile,
    toTile: value.toTile,
    fromUpdate: value.fromUpdate,
    toUpdate: value.toUpdate,
  });

export const decodeMove = (bytes: Uint8Array): MoveResult => {
  const parsed = move.safeParse(cbor.decode(bytes));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
};

const tileIndex = z
  .union([z.int(), z.bigint()])
  .transform(Number)
  .refine(Number.isSafeInteger, "tile index is not a safe integer");

export const tileHint = z.strictObject({
  level: z.int(),
  tx: tileIndex,
  ty: tileIndex,
  count: z.int().min(1),
});

export type TileHint = z.infer<typeof tileHint>;

export type HintsResult = { ok: true; value: TileHint[] } | { ok: false; error: string };

export const encodeHints = (hints: readonly TileHint[]): Uint8Array =>
  cbor.encode(hints.map(({ level, tx, ty, count }) => ({ level, tx, ty, count })));

export const decodeHints = (bytes: Uint8Array): HintsResult => {
  const parsed = z.array(tileHint).safeParse(cbor.decode(bytes));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
};
