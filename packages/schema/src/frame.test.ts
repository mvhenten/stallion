import { expect, test } from "vitest";
import { decodeFrame, decodeMove, encodeFrame, encodeMove, type Frame, type Move } from "./frame";

const sync: Frame = { tileKey: "-3:4:-5", kind: "Sync", payload: new Uint8Array([0, 1, 2]) };

const hex = (bytes: Uint8Array): string =>
  `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}\n`;

test("matches the golden frame fixture shared with the server", async () => {
  await expect(hex(encodeFrame(sync))).toMatchFileSnapshot("../fixtures/frame.cbor.hex");
});

const move: Move = {
  objectId: "stroke-0001",
  fromTile: "0:0:0",
  toTile: "1:-1:2",
  fromUpdate: new Uint8Array([1]),
  toUpdate: new Uint8Array([2, 3]),
};

test("matches the golden move fixture shared with the server", async () => {
  await expect(hex(encodeMove(move))).toMatchFileSnapshot("../fixtures/move.cbor.hex");
  const decoded = decodeMove(encodeMove(move));
  expect(decoded.ok && Array.from(decoded.value.toUpdate)).toEqual([2, 3]);
});

test("round-trips a frame and rejects an unknown kind", () => {
  const decoded = decodeFrame(encodeFrame(sync));
  expect(decoded.ok && Array.from(decoded.value.payload)).toEqual([0, 1, 2]);
  const bogus = encodeFrame({ ...sync, kind: "Nope" as Frame["kind"] });
  expect(decodeFrame(bogus).ok).toBe(false);
});
