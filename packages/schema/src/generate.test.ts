import { expect, test } from "vitest";
import { jsonSchema, validatorSource, validatorTypes } from "./generate";

test("checked-in JSON Schema matches the zod models", async () => {
  await expect(`${JSON.stringify(jsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
    "../generated/object.schema.json",
  );
});

test("checked-in validator matches the JSON Schema", async () => {
  await expect(validatorSource()).toMatchFileSnapshot("../generated/validate.js");
  await expect(validatorTypes()).toMatchFileSnapshot("../generated/validate.d.ts");
});
