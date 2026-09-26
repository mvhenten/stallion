import { describe, expect, it } from "vitest";
import { boardIdFromPath, boardPath, boardSlug } from "./board-path";

describe("boardSlug", () => {
  it.each([
    ["My Custom Board", "my-custom-board"],
    ["  Sprint #42: plan & review!  ", "sprint-42-plan-review"],
    ["Café déjà vu", "caf-d-j-vu"],
    ["---", ""],
    ["", ""],
    [`${"a".repeat(59)} b`, "a".repeat(59)],
    ["x".repeat(80), "x".repeat(60)],
  ])("derives %j as %j", (name, slug) => {
    expect(boardSlug(name)).toBe(slug);
  });
});

describe("boardPath", () => {
  it("adds the slug after the id", () => {
    expect(boardPath("abc", "My Custom Board")).toBe("/b/abc/my-custom-board");
  });

  it("leaves the slug off when the name is empty or still the id", () => {
    expect(boardPath("abc", "")).toBe("/b/abc");
    expect(boardPath("abc", "abc")).toBe("/b/abc");
  });
});

describe("boardIdFromPath", () => {
  it("reads the id from both forms and ignores the slug", () => {
    const id = "0a1b2c3d4e5f6g7h8i9j0k1l2";
    expect(boardIdFromPath(`/b/${id}`)).toBe(id);
    expect(boardIdFromPath(`/b/${id}/my-custom-board`)).toBe(id);
    expect(boardIdFromPath(`/b/${id}/stale-name`)).toBe(id);
    expect(boardIdFromPath("/b/default")).toBe("default");
    expect(boardIdFromPath("/b/Old_id-12/")).toBe("Old_id-12");
  });

  it("matches nothing else", () => {
    expect(boardIdFromPath("/")).toBeUndefined();
    expect(boardIdFromPath("/b/")).toBeUndefined();
    expect(boardIdFromPath("/b/a/b/c")).toBeUndefined();
    expect(boardIdFromPath("/other")).toBeUndefined();
  });
});
