import { describe, expect, it } from "vitest";
import { lastOpenedLabel } from "./landing";

describe("lastOpenedLabel", () => {
  it("shows not opened yet for a board that was never opened", () => {
    expect(lastOpenedLabel(0, Date.now())).toBe("not opened yet");
  });

  it("shows a relative time for a board that was opened", () => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(lastOpenedLabel(oneHourAgo, now)).toBe("1 hour ago");
  });
});
