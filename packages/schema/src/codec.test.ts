import { Encoder } from "cbor-x";
import { expect, test } from "vitest";
import { decode, encode } from "./codec";
import type { StallionObject } from "./model";
import { stallionObject } from "./model";

const stroke: StallionObject = {
  type: "Stroke",
  objectId: "stroke-0001",
  nativeZoom: -3,
  bbox: { minX: 10, minY: 12.5, maxX: 42, maxY: 30.25 },
  colour: 2,
  size: "Medium",
  points: [
    [10, 12.5, 0.5],
    [26, 20, 0.75],
    [42, 30.25, 1],
  ],
};

const objects: StallionObject[] = [
  stroke,
  {
    type: "Shape",
    objectId: "shape-0001",
    nativeZoom: 0,
    bbox: { minX: 0, minY: 0, maxX: 256, maxY: 128 },
    colour: 5,
    size: "Large",
    shape: "Ellipse",
  },
  {
    type: "Text",
    objectId: "text-0001",
    nativeZoom: 40,
    bbox: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    colour: 0,
    size: "Small",
    text: "hello",
  },
];

const raw = new Encoder({ useRecords: false, mapsAsObjects: true, variableMapSize: true });

const hex = (bytes: Uint8Array): string =>
  `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}\n`;

test.each(objects)("round-trips a $type", (object) => {
  expect(stallionObject.parse(object)).toEqual(object);
  expect(decode(encode(object))).toEqual({ ok: true, value: object });
});

test("matches the golden stroke fixture", async () => {
  await expect(hex(encode(stroke))).toMatchFileSnapshot("../fixtures/stroke.cbor.hex");
});

test.each([
  ["a colour outside the palette", { ...stroke, colour: 6 }],
  ["a pressure above one", { ...stroke, points: [[0, 0, 1.5]] }],
  ["a zoom level beyond 40", { ...stroke, nativeZoom: 41 }],
  ["an unknown field", { ...stroke, extra: true }],
])("rejects %s", (_, invalid) => {
  expect(stallionObject.safeParse(invalid).success).toBe(false);
  expect(decode(raw.encode(invalid))).toMatchObject({ ok: false });
  expect(() => encode(invalid as unknown as StallionObject)).toThrow(TypeError);
});
