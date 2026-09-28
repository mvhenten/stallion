import { Encoder } from "cbor-x";
import { validate } from "../generated/validate.js";
import { withRgb } from "./colour";
import type { StallionObject } from "./model";
import { withWidth } from "./width";

export type DecodeResult = { ok: true; value: StallionObject } | { ok: false; error: string };

const cbor = new Encoder({ useRecords: false, mapsAsObjects: true, variableMapSize: true });

const describeErrors = (): string =>
  (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ");

export const encode = (object: StallionObject): Uint8Array => {
  if (!validate(object)) {
    throw new TypeError(`Cannot encode an invalid object: ${describeErrors()}`);
  }
  return cbor.encode(withWidth(withRgb(object)));
};

export const decode = (bytes: Uint8Array): DecodeResult => {
  const value: unknown = cbor.decode(bytes);
  if (!validate(value)) {
    return { ok: false, error: describeErrors() };
  }
  return { ok: true, value: withWidth(withRgb(value)) };
};
