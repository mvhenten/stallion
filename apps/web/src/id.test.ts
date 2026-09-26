import { isBoardId } from "@stallion/client-sync";
import { describe, expect, it } from "vitest";
import { ID_LENGTH, randomBoardId } from "./id";

describe("randomBoardId", () => {
  it("encodes 128 random bits as 25 lower-case base36 characters", () => {
    for (let i = 0; i < 200; i++) {
      const id = randomBoardId();
      expect(id).toHaveLength(ID_LENGTH);
      expect(id).toMatch(/^[a-z0-9]{25}$/);
      expect(isBoardId(id)).toBe(true);
    }
  });

  it("does not repeat across a large sample", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomBoardId()));
    expect(ids.size).toBe(500);
  });
});
