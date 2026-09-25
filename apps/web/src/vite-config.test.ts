import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("vite config", () => {
  it("keeps the dep optimizer cache out of node_modules so npm ci cannot delete it under a running dev server", () => {
    expect(config.cacheDir).toBeDefined();
    expect(config.cacheDir).not.toMatch(/node_modules/);
  });
});
