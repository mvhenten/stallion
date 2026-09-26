import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD,
  loadRecents,
  MAX_RECENTS,
  RECENTS_KEY,
  type RecentBoard,
  removeRecent,
  renameRecent,
  saveRecents,
  upsertRecent,
} from "./recents";

class FakeStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const board = (id: string, lastOpened: number): RecentBoard => ({
  id,
  name: id,
  lastOpened,
  thumbnail: "",
});

describe("loadRecents", () => {
  it("seeds the default board on a device that has never stored recents", () => {
    expect(loadRecents(new FakeStorage())).toEqual([
      { id: DEFAULT_BOARD, name: DEFAULT_BOARD, lastOpened: 0, thumbnail: "" },
    ]);
  });

  it("returns an empty list once the key exists but every entry was removed", () => {
    const storage = new FakeStorage();
    storage.setItem(RECENTS_KEY, "[]");
    expect(loadRecents(storage)).toEqual([]);
  });

  it("drops malformed entries instead of throwing", () => {
    const storage = new FakeStorage();
    storage.setItem(RECENTS_KEY, JSON.stringify([{ id: "ok", name: "ok" }, "junk", 42]));
    expect(loadRecents(storage)).toEqual([]);
  });

  it("recovers from corrupt JSON", () => {
    const storage = new FakeStorage();
    storage.setItem(RECENTS_KEY, "{not json");
    expect(loadRecents(storage)).toEqual([]);
  });
});

describe("saveRecents", () => {
  it("round-trips through the storage key", () => {
    const storage = new FakeStorage();
    const recents = [board("a", 1)];
    saveRecents(storage, recents);
    expect(loadRecents(storage)).toEqual(recents);
  });
});

describe("upsertRecent", () => {
  it("puts a newly opened board at the front", () => {
    const recents = [board("a", 1)];
    const next = upsertRecent(recents, { id: "b", lastOpened: 2 });
    expect(next.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("moves a reopened board back to the front and keeps its name", () => {
    const recents = [board("a", 3), board("b", 2), board("c", 1)];
    const named = renameRecent(recents, "c", "My old board");
    const next = upsertRecent(named, { id: "c", lastOpened: 4 });
    expect(next.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(next[0]).toMatchObject({ name: "My old board", lastOpened: 4 });
  });

  it("defaults a new board's name to its id", () => {
    const next = upsertRecent([], { id: "fresh-id", lastOpened: 1 });
    expect(next[0]).toMatchObject({ id: "fresh-id", name: "fresh-id" });
  });

  it("caps the list at 50, dropping the oldest", () => {
    const recents = Array.from({ length: MAX_RECENTS }, (_, i) => board(`id-${i}`, i));
    const next = upsertRecent(recents, { id: "newest", lastOpened: MAX_RECENTS });
    expect(next).toHaveLength(MAX_RECENTS);
    expect(next[0]?.id).toBe("newest");
    expect(next.some((r) => r.id === "id-0")).toBe(false);
  });
});

describe("removeRecent", () => {
  it("forgets one board without touching the rest", () => {
    const recents = [board("a", 2), board("b", 1)];
    expect(removeRecent(recents, "a")).toEqual([board("b", 1)]);
  });
});

describe("renameRecent", () => {
  it("renames one board in place", () => {
    const recents = [board("a", 2), board("b", 1)];
    const next = renameRecent(recents, "b", "Sketchbook");
    expect(next.find((r) => r.id === "b")).toMatchObject({ name: "Sketchbook" });
    expect(next.find((r) => r.id === "a")).toMatchObject({ name: "a" });
  });
});
