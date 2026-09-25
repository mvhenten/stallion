import { Ajv } from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { z } from "zod";
import { stallionObject } from "./model";

export const jsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(stallionObject, { target: "draft-07" });

export const validatorSource = (): string => {
  const ajv = new Ajv({ code: { source: true, esm: true }, unicode: false });
  const validate = ajv.compile(jsonSchema());
  return `${standaloneCode(ajv, validate)}\n`;
};

export const validatorTypes = (): string =>
  [
    'import type { ErrorObject } from "ajv";',
    'import type { StallionObject } from "../src/model";',
    "",
    "type Validate = ((data: unknown) => data is StallionObject) & { errors?: ErrorObject[] | null };",
    "",
    "export declare const validate: Validate;",
    "export default validate;",
    "",
  ].join("\n");
