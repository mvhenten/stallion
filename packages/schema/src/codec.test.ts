import { readFileSync } from "node:fs";
import { Encoder } from "cbor-x";
import { expect, test } from "vitest";
import { decode, encode } from "./codec";
import type { StallionObject } from "./model";
import { stallionObject } from "./model";
import { STROKE_STYLES } from "./style";

const stroke: StallionObject = {
  type: "Stroke",
  objectId: "stroke-0001",
  nativeZoom: -3,
  bbox: { minX: 10, minY: 12.5, maxX: 42, maxY: 30.25 },
  colour: 0,
  rgb: 0x123456,
  size: "Medium",
  width: 12.5,
  style: "Highlighter",
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
    rgb: 0x8e4ec6,
    size: "Large",
    width: 20,
    shape: "Ellipse",
  },
  {
    type: "Text",
    objectId: "text-0001",
    nativeZoom: 40,
    bbox: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    colour: 0,
    rgb: 0x1f2328,
    size: "Small",
    width: 3,
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

test.each(STROKE_STYLES)("round-trips a %s stroke", (style) => {
  const styled: StallionObject = { ...stroke, style };
  expect(decode(encode(styled))).toEqual({ ok: true, value: styled });
});

test("matches the golden stroke fixture", async () => {
  await expect(hex(encode(stroke))).toMatchFileSnapshot("../fixtures/stroke.cbor.hex");
});

const legacyBytes = (): Uint8Array => {
  const text = readFileSync(new URL("../fixtures/stroke-legacy.cbor.hex", import.meta.url), "utf8");
  return Uint8Array.from(text.trim().match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
};

test("decodes a legacy stroke without rgb, width or style as a Pen and derives each", () => {
  const decoded = decode(legacyBytes());
  expect(decoded).toMatchObject({
    ok: true,
    value: { colour: 2, rgb: 0xf76b15, width: 8, style: "Pen" },
  });
  const legacy = raw.decode(legacyBytes()) as Record<string, unknown>;
  expect(legacy.rgb).toBeUndefined();
  expect(legacy.width).toBeUndefined();
  expect(legacy.style).toBeUndefined();
  expect(raw.decode(encode(legacy as unknown as StallionObject))).toMatchObject({
    rgb: 0xf76b15,
    width: 8,
    style: "Pen",
  });
});

test.each([
  ["an rgb above 0xFFFFFF", { ...stroke, rgb: 0x1000000 }],
  ["a negative rgb", { ...stroke, rgb: -1 }],
  ["a width below 0.5", { ...stroke, width: 0.4 }],
  ["a width above 96", { ...stroke, width: 96.5 }],
  ["an infinite width", { ...stroke, width: Number.POSITIVE_INFINITY }],
  ["a NaN width", { ...stroke, width: Number.NaN }],
  ["an unknown style", { ...stroke, style: "Marker" }],
  ["a colour outside the palette", { ...stroke, colour: 6 }],
  ["a pressure above one", { ...stroke, points: [[0, 0, 1.5]] }],
  ["a zoom level beyond 40", { ...stroke, nativeZoom: 41 }],
  ["an unknown field", { ...stroke, extra: true }],
])("rejects %s", (_, invalid) => {
  expect(stallionObject.safeParse(invalid).success).toBe(false);
  expect(decode(raw.encode(invalid))).toMatchObject({ ok: false });
  expect(() => encode(invalid as unknown as StallionObject)).toThrow(TypeError);
});
