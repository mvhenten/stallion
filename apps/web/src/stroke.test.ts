import { fromTileLocal, MAX_LEVEL, tileKey } from "@stallion/geometry";
import { afterEach, describe, expect, test, vi } from "vitest";
import { finishDraft, startDraft, strokeFrame, translateStroke } from "./stroke";

describe("finishDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("commits a stroke outside a secure context, where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const draft = startDraft(0, "Medium", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    const stored = finishDraft(draft);
    expect(stored?.object.objectId).toMatch(/^[0-9a-z]{9}[0-9a-f]{12}$/);
  });
});

describe("strokeFrame", () => {
  test("keeps a stroke across the world origin drawable in float32 canvas paths", () => {
    const zoom = 1 / 9;
    const draft = startDraft(0, "Medium", zoom);
    const circle = Array.from({ length: 25 }, (_, i) => {
      const angle = (i / 24) * 2 * Math.PI;
      return { x: 600 + (300 * Math.cos(angle)) / zoom, y: 960 + (300 * Math.sin(angle)) / zoom };
    });
    for (const { x, y } of circle) draft.points.push([x, y, 0.5]);
    const stored = finishDraft(draft);
    if (stored?.object.type !== "Stroke") throw new Error("stroke not placed");
    expect(stored.tile.level).toBe(MAX_LEVEL);

    const frame = strokeFrame(stored.tile, stored.object);
    frame.points.forEach(([x, y], i) => {
      const drawn = circle[i];
      expect(frame.origin.x + Math.fround(x) * frame.scale).toBeCloseTo(drawn?.x ?? Number.NaN, 0);
      expect(frame.origin.y + Math.fround(y) * frame.scale).toBeCloseTo(drawn?.y ?? Number.NaN, 0);
    });
  });
});

describe("translateStroke", () => {
  test("re-places a stroke dragged across a tile boundary and keeps its world points", () => {
    const draft = startDraft(0, "Small", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    const stored = finishDraft(draft);
    if (stored?.object.type !== "Stroke") throw new Error("no stroke");
    const moved = translateStroke(stored.tile, stored.object, 300, 0);
    expect(moved && tileKey(moved.tile)).not.toBe(tileKey(stored.tile));
    const [first] = moved?.object.type === "Stroke" ? moved.object.points : [];
    const world = first && moved && fromTileLocal(moved.tile, { x: first[0], y: first[1] });
    expect(world?.x).toBeCloseTo(310);
    expect(world?.y).toBeCloseTo(10);
  });
});
