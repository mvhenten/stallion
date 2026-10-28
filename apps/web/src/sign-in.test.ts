import { expect, test, vi } from "vitest";
import { type SignInStorage, signInRedirect } from "./sign-in";

const memoryStorage = (): SignInStorage => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
};

test("an expired sign-in navigates to the login once", () => {
  const navigate = vi.fn();
  const redirect = signInRedirect(memoryStorage, navigate);

  expect(redirect.expired()).toBe(true);
  expect(navigate).toHaveBeenCalledOnce();
});

test("expiring again after the redirect shows the notice instead", () => {
  const storage = memoryStorage();
  const navigate = vi.fn();
  const redirect = signInRedirect(() => storage, navigate);

  redirect.expired();
  expect(redirect.expired()).toBe(false);
  expect(navigate).toHaveBeenCalledOnce();

  redirect.signedIn();
  expect(redirect.expired()).toBe(true);
});

test("a throwing storage shows the notice without navigating", () => {
  const navigate = vi.fn();
  const redirect = signInRedirect(() => {
    throw new Error("SecurityError");
  }, navigate);

  expect(redirect.expired()).toBe(false);
  redirect.signedIn();
  expect(navigate).not.toHaveBeenCalled();
});
