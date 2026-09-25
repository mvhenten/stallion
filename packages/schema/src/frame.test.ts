import { expect, test } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "./frame";

const sync: Frame = { tileKey: "-3:4:-5", kind: "Sync", payload: new Uint8Array([0, 1, 2]) };

const hex = (bytes: Uint8Array): string =>
  `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}\n`;

test("matches the golden frame fixture shared with the server", async () => {
  await expect(hex(encodeFrame(sync))).toMatchFileSnapshot("../fixtures/frame.cbor.hex");
});

test("round-trips a frame and rejects an unknown kind", () => {
  const decoded = decodeFrame(encodeFrame(sync));
  expect(decoded.ok && Array.from(decoded.value.payload)).toEqual([0, 1, 2]);
  const bogus = encodeFrame({ ...sync, kind: "Nope" as Frame["kind"] });
  expect(decodeFrame(bogus).ok).toBe(false);
});
