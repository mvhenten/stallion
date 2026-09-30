import { readFileSync } from "node:fs";
import { Encoder } from "cbor-x";
import { expect, test } from "vitest";
import { decode, encode } from "./codec";
import type { StallionObject } from "./model";
import { stallionObject } from "./model";
import { SHAPE_FILLS, SHAPE_KINDS } from "./shape";
import { clampUtf8, utf8Length } from "./sticky";
import { STROKE_STYLES } from "./style";
import { MAX_HREF_BYTES, parseHref } from "./text-style";

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

const shape: StallionObject = {
  type: "Shape",
  objectId: "shape-0001",
  nativeZoom: 0,
  bbox: { minX: 0, minY: 0, maxX: 256, maxY: 128 },
  colour: 5,
  rgb: 0x8e4ec6,
  size: "Large",
  width: 20,
  style: "Dashed",
  kind: "Arrow",
  start: [240.5, 12],
  end: [16, 116.25],
  fill: "Tint",
};

const legacySticky = {
  type: "Sticky",
  objectId: "sticky-0001",
  nativeZoom: 1,
  bbox: { minX: -40, minY: 8.5, maxX: 160, maxY: 208.5 },
  rgb: 0x1f2328,
  background: 0xf76b15,
  width: 18,
  text: "Buy milk\nand a very long line that wraps",
} as const;

const sticky: StallionObject = {
  ...legacySticky,
  font: "Hand",
  bold: true,
  italic: false,
  fit: "Auto",
};

const legacyText = {
  type: "Text",
  objectId: "text-0001",
  nativeZoom: -2,
  bbox: { minX: 12, minY: -8, maxX: 92, maxY: 23.2 },
  rgb: 0xe5484d,
  width: 24,
  wrapWidth: 160,
  text: "Plain text that wraps\nover lines",
} as const;

const text: StallionObject = {
  ...legacyText,
  font: "Serif",
  bold: true,
  italic: true,
  href: "https://example.com/a?b=c#d",
  fit: "Fixed",
};

const objects: StallionObject[] = [stroke, shape, sticky, text];

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

test.each(SHAPE_KINDS.flatMap((kind) => SHAPE_FILLS.map((fill) => ({ kind, fill }))))(
  "round-trips a $kind shape with fill $fill",
  ({ kind, fill }) => {
    const variant: StallionObject = { ...shape, kind, fill };
    expect(decode(encode(variant))).toEqual({ ok: true, value: variant });
  },
);

test("matches the golden shape fixture", async () => {
  await expect(hex(encode(shape))).toMatchFileSnapshot("../fixtures/shape.cbor.hex");
});

test("matches the golden sticky fixture", async () => {
  await expect(hex(encode(sticky))).toMatchFileSnapshot("../fixtures/sticky-v2.cbor.hex");
});

test("matches the golden text fixture", async () => {
  await expect(hex(encode(text))).toMatchFileSnapshot("../fixtures/text-v2.cbor.hex");
});

const fixtureBytes = (name: string): Uint8Array => {
  const text = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  return Uint8Array.from(text.trim().match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
};

const PLAIN = { font: "Sans", bold: false, italic: false, fit: "Fixed" } as const;

test.each([
  ["sticky.cbor.hex", legacySticky],
  ["text.cbor.hex", legacyText],
])("decodes the pre-style %s with the default face and writes it back", (name, legacy) => {
  const decoded = decode(fixtureBytes(name));
  expect(decoded).toEqual({ ok: true, value: { ...legacy, ...PLAIN } });
  expect(raw.decode(fixtureBytes(name))).not.toHaveProperty("font");
  expect(raw.decode(encode(legacy as unknown as StallionObject))).toEqual({ ...legacy, ...PLAIN });
});

test("round-trips a text without a link", () => {
  const { href: _href, ...unlinked } = text as Extract<StallionObject, { type: "Text" }>;
  expect(decode(encode(unlinked))).toEqual({ ok: true, value: unlinked });
});

test.each([
  ["example.com/page", "https://example.com/page"],
  [" http://Example.com ", "http://example.com/"],
  ["https://example.com/a b", "https://example.com/a%20b"],
  ["https://exämple.com/", "https://xn--exmple-cua.com/"],
])("parses the link %s as %s", (input, href) => {
  expect(parseHref(input)).toBe(href);
});

test.each([
  "",
  "javascript:alert(1)",
  "mailto:someone@example.com",
  "ftp://example.com/",
  "https://",
  "bad link",
  "localhostish",
  `https://example.com/${"a".repeat(MAX_HREF_BYTES)}`,
])("refuses the link %j", (input) => {
  expect(parseHref(input)).toBeUndefined();
});

test("round-trips an empty sticky", () => {
  const empty: StallionObject = { ...sticky, text: "" };
  expect(decode(encode(empty))).toEqual({ ok: true, value: empty });
});

test("clamps sticky text to 4096 UTF-8 bytes without splitting a character", () => {
  const long = "é".repeat(2049);
  expect(utf8Length(long)).toBe(4098);
  const kept = clampUtf8(long);
  expect(utf8Length(kept)).toBe(4096);
  expect(kept).toBe("é".repeat(2048));
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
  ["an unknown shape kind", { ...shape, kind: "Star" }],
  ["an unknown shape fill", { ...shape, fill: "Solid" }],
  ["a shape without an end", { ...shape, end: undefined }],
  ["a shape point with three coordinates", { ...shape, start: [1, 2, 3] }],
  ["a shape width above 96", { ...shape, width: 97 }],
  ["a sticky without a background", { ...sticky, background: undefined }],
  ["a sticky background above 0xFFFFFF", { ...sticky, background: 0x1000000 }],
  ["a sticky font below 0.5", { ...sticky, width: 0.25 }],
  ["a sticky with a colour index", { ...sticky, colour: 0 }],
  ["a sticky with text over 4096", { ...sticky, text: "x".repeat(4097) }],
  ["an empty text", { ...text, text: "" }],
  ["a text with a colour index", { ...text, colour: 0 }],
  ["a text without a wrap width", { ...text, wrapWidth: undefined }],
  ["a text wrap width of zero", { ...text, wrapWidth: 0 }],
  ["a text wrap width wider than its tile", { ...text, wrapWidth: 256.5 }],
  ["a text font above 96", { ...text, width: 97 }],
  ["an unknown font", { ...text, font: "Comic" }],
  ["a bold that is not a boolean", { ...sticky, bold: 1 }],
  ["an unknown fit", { ...sticky, fit: "Grow" }],
  ["a javascript link", { ...text, href: "javascript:alert(1)" }],
  ["a link without a host", { ...text, href: "https://" }],
  ["a link with a space", { ...text, href: "https://example.com/a b" }],
  ["a link with an encoded host", { ...text, href: "https://bad%20link/" }],
  ["a link with a user", { ...text, href: "https://user@example.com/" }],
  ["a link over 2048 bytes", { ...text, href: `https://example.com/${"a".repeat(2048)}` }],
  ["a sticky with a mailto link", { ...sticky, href: "mailto:someone@example.com" }],
])("rejects %s", (_, invalid) => {
  expect(stallionObject.safeParse(invalid).success).toBe(false);
  expect(decode(raw.encode(invalid))).toMatchObject({ ok: false });
  expect(() => encode(invalid as unknown as StallionObject)).toThrow(TypeError);
});
