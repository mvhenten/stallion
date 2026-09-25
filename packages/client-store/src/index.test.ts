import { expect, test } from "vitest";
import { packageName } from "./index";

test("exposes its package name", () => {
  expect(packageName).toBe("@stallion/client-store");
});
