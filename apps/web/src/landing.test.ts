import { describe, expect, it, vi } from "vitest";
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
  it("redirects to the login when Access redirects to its login page", () => {
    const redirect = { expired: vi.fn(() => true), signedIn: vi.fn() };
    expect(remoteAfter("AuthRedirect", "the sign-in expired", redirect).state).toBe("SigningIn");
    expect(redirect.expired).toHaveBeenCalledOnce();
  });

  it("shows the signed-out state when the redirect already ran", () => {
    const redirect = { expired: () => false, signedIn: vi.fn() };
    expect(remoteAfter("Http401", "the sign-in expired", redirect).state).toBe("SignedOut");
  });
});
