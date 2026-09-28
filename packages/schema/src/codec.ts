import { Encoder } from "cbor-x";
import { validate } from "../generated/validate.js";
import { withRgb } from "./colour";
import type { StallionObject } from "./model";
import { withStyle } from "./style";
import { withWidth } from "./width";

export type DecodeResult = { ok: true; value: StallionObject } | { ok: false; error: string };

const cbor = new Encoder({ useRecords: false, mapsAsObjects: true, variableMapSize: true });

const normalise = (object: StallionObject): StallionObject => {
  const complete = withWidth(withRgb(object));
  return complete.type === "Stroke" ? withStyle(complete) : complete;
};

const describeErrors = (): string =>
  (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ");

export const encode = (object: StallionObject): Uint8Array => {
  if (!validate(object)) {
    throw new TypeError(`Cannot encode an invalid object: ${describeErrors()}`);
  }
  return cbor.encode(normalise(object));
};

export const decode = (bytes: Uint8Array): DecodeResult => {
  const value: unknown = cbor.decode(bytes);
  if (!validate(value)) {
    return { ok: false, error: describeErrors() };
  }
  return { ok: true, value: normalise(value) };
};
