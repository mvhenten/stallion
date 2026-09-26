import { isBoardId } from "@stallion/client-sync";
import { describe, expect, it } from "vitest";
import { ID_ALPHABET, ID_LENGTH, randomBoardId } from "./id";

describe("randomBoardId", () => {
  it("uses an alphabet of exactly 64 characters so a random byte is unbiased", () => {
    expect(ID_ALPHABET).toHaveLength(64);
    expect(new Set(ID_ALPHABET).size).toBe(64);
  });

  it("generates 12 characters the server's board id pattern accepts", () => {
    const id = randomBoardId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(isBoardId(id)).toBe(true);
    for (const char of id) expect(ID_ALPHABET).toContain(char);
  });

  it("does not repeat across a large sample", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomBoardId()));
    expect(ids.size).toBe(500);
  });
});
