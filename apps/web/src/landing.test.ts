import { describe, expect, it } from "vitest";
import { lastOpenedLabel, remoteAfter } from "./landing";

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

describe("remoteAfter", () => {
  it("shows the signed-out state when Access redirects to its login page", () => {
    expect(remoteAfter("AuthRedirect", "the sign-in expired").state).toBe("SignedOut");
  });
});
