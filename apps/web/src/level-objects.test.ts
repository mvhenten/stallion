import type { StallionObject } from "@stallion/schema";
import { expect, test } from "vitest";
import { nearestFirst, objectLabel, placeFlyout, previewFit } from "./level-objects";

const box = (x: number, y: number, size = 10) => ({
  minX: x,
  minY: y,
  maxX: x + size,
  maxY: y + size,
});

test("objects come nearest the view centre first, capped with a count of the rest", () => {
  const items = [
    { objectId: "far", bbox: box(1000, 0) },
    { objectId: "near", bbox: box(-5, -5) },
    { objectId: "mid", bbox: box(100, 100) },
  ];
  expect(nearestFirst(items, { x: 0, y: 0 }).items.map((item) => item.objectId)).toEqual([
    "near",
    "mid",
    "far",
  ]);
  const capped = nearestFirst(items, { x: 0, y: 0 }, 2);
  expect(capped.items.map((item) => item.objectId)).toEqual(["near", "mid"]);
  expect(capped.more).toBe(1);
});

test("a label is the type, with the first 24 characters of a note or text", () => {
  const base = { objectId: "o", nativeZoom: 0, bbox: box(0, 0) };
  expect(objectLabel({ ...base, type: "Stroke" } as StallionObject)).toBe("Stroke");
  expect(objectLabel({ ...base, type: "Shape", kind: "Ellipse" } as StallionObject)).toBe(
    "Ellipse",
  );
  expect(
    objectLabel({
      ...base,
      type: "Sticky",
      text: "Buy milk\nand   a very long list of things",
    } as StallionObject),
  ).toBe("Note: Buy milk and a very long…");
  expect(objectLabel({ ...base, type: "Text", text: "Hello" } as StallionObject)).toBe(
    "Text: Hello",
  );
  expect(objectLabel({ ...base, type: "Sticky", text: "  " } as StallionObject)).toBe("Note");
});

test("the preview fit scales the extent into the padded thumbnail and centres it", () => {
  const fit = previewFit({ minX: 100, minY: 0, maxX: 300, maxY: 50 }, 64, 40, 4);
  expect(fit.scale).toBeCloseTo(56 / 200);
  const toPreview = (x: number, y: number) => ({
    x: (x - fit.x) * fit.scale,
    y: (y - fit.y) * fit.scale,
  });
  expect(toPreview(100, 0).x).toBeCloseTo(4);
  expect(toPreview(300, 50).x).toBeCloseTo(60);
  expect(toPreview(200, 25).y).toBeCloseTo(20);
  const dot = previewFit({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  expect(Number.isFinite(dot.scale)).toBe(true);
});

test("the flyout opens right of the list, left when there is no room, below on a phone", () => {
  const option = { left: 100, top: 200, right: 172, bottom: 244 };
  const list = { left: 100, top: 100, right: 172, bottom: 500 };
  const right = placeFlyout(option, list, { width: 1280, height: 800 });
  expect(right.side).toBe("Right");
  expect(right.left).toBe(180);
  expect(right.top).toBe(200);
  const nearEdge = { left: 1100, top: 100, right: 1172, bottom: 500 };
  const left = placeFlyout({ ...option, left: 1100, right: 1172 }, nearEdge, {
    width: 1280,
    height: 800,
  });
  expect(left.side).toBe("Left");
  expect(left.left).toBe(1100 - 8 - 240);
  const phone = placeFlyout(
    option,
    { left: 60, top: 60, right: 132, bottom: 400 },
    {
      width: 360,
      height: 844,
    },
  );
  expect(phone.side).toBe("Below");
  expect(phone.top).toBe(408);
  expect(phone.left + 240).toBeLessThanOrEqual(360 - 8);
  const low = placeFlyout({ ...option, top: 780 }, list, { width: 1280, height: 800 });
  expect(low.top + low.maxHeight).toBeLessThanOrEqual(792);
});
