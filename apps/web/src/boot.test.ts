import { describe, expect, it } from "vitest";
import { boot } from "./boot";

const root = { id: "app" };

describe("boot", () => {
  it("reports a module that fails to load instead of leaving a blank page", async () => {
    const failures: string[] = [];
    await boot(
      root,
      () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
      (message) => failures.push(message),
    );
    expect(failures).toEqual([
      "The drawing board could not start: Failed to fetch dynamically imported module",
    ]);
  });

  it("reports a mount that throws", async () => {
    const failures: string[] = [];
    await boot(
      root,
      async () => ({
        mount: () => {
          throw new Error("crypto.randomUUID is not a function");
        },
      }),
      (message) => failures.push(message),
    );
    expect(failures).toEqual([
      "The drawing board could not start: crypto.randomUUID is not a function",
    ]);
  });

  it("mounts once the app loads", async () => {
    const mounted: (typeof root)[] = [];
    await boot(
      root,
      async () => ({ mount: (target) => mounted.push(target) }),
      () => undefined,
    );
    expect(mounted).toEqual([root]);
  });
});
