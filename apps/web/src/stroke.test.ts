import { fromTileLocal, MAX_LEVEL, tileKey } from "@stallion/geometry";
import { nearestSize, PENCIL_PX, type Stroke, widthOf } from "@stallion/schema";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  finishDraft,
  PENCIL_SIZES,
  sliderToWidth,
  startDraft,
  strokeFrame,
  strokeWorldWidth,
  translateStroke,
  WIDTH_SLIDER_STEPS,
  widthToSlider,
} from "./stroke";

describe("width", () => {
  test("maps each size to its width and each width to the nearest size", () => {
    for (const size of PENCIL_SIZES) {
      expect(widthOf({ size })).toBe(PENCIL_PX[size]);
      expect(nearestSize(PENCIL_PX[size])).toBe(size);
    }
    expect(widthOf({ size: "Large", width: 1 })).toBe(1);
    expect(nearestSize(0.5)).toBe("Small");
    expect(nearestSize(4.8)).toBe("Small");
    expect(nearestSize(5)).toBe("Medium");
    expect(nearestSize(12)).toBe("Medium");
    expect(nearestSize(13)).toBe("Large");
    expect(nearestSize(96)).toBe("Large");
  });

  test("commits the draft width and the nearest size, and scales the world width by it", () => {
    const draft = startDraft(0, 60, "Pen", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    const stroke = finishDraft(draft)?.object as Stroke;
    expect(stroke).toMatchObject({ width: 60, size: "Large" });
    expect(strokeWorldWidth(60, 0) / strokeWorldWidth(1, 0)).toBe(60);
  });

  test("the slider spans 0.5 to 96 and round-trips every preset width", () => {
    expect(sliderToWidth(0)).toBe(0.5);
    expect(sliderToWidth(WIDTH_SLIDER_STEPS)).toBe(96);
    for (const width of [0.5, 1, 2, 3, 8, 20, 40, 60, 96]) {
      expect(Math.abs(sliderToWidth(widthToSlider(width)) - width) / width).toBeLessThan(0.06);
    }
  });
});

describe("finishDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("commits the draft style", () => {
    const draft = startDraft(0, 8, "Dashed", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    expect(finishDraft(draft)?.object).toMatchObject({ style: "Dashed" });
  });

  test("commits a stroke outside a secure context, where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const draft = startDraft(0, 8, "Pen", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    const stored = finishDraft(draft);
    expect(stored?.object.objectId).toMatch(/^[0-9a-z]{9}[0-9a-f]{12}$/);
  });
});

describe("strokeFrame", () => {
  test("keeps a stroke across the world origin drawable in float32 canvas paths", () => {
    const zoom = 1 / 9;
    const draft = startDraft(0, 8, "Pen", zoom);
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
    const draft = startDraft(0, 3, "Pen", 1);
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
