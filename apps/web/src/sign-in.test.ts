import { expect, test, vi } from "vitest";
import { returnPath, type SignInStorage, signInPath, signInRedirect } from "./sign-in";

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
  const redirect = signInRedirect(memoryStorage(), navigate);

  expect(redirect.redirectOnce()).toBe(true);
  expect(navigate).toHaveBeenCalledOnce();
});

test("expiring again after the redirect shows the notice instead", () => {
  const navigate = vi.fn();
  const redirect = signInRedirect(memoryStorage(), navigate);

  redirect.redirectOnce();
  expect(redirect.redirectOnce()).toBe(false);
  expect(navigate).toHaveBeenCalledOnce();

  redirect.signedIn();
  expect(redirect.redirectOnce()).toBe(true);
});

test("the sign-in route returns to the page it came from, on this origin only", () => {
  const origin = "https://stallion.example";
  const search = signInPath({ pathname: "/b/abc/my-board", search: "?x=1" }).split("?")[1];

  expect(returnPath(`?${search}`, origin)).toBe("/b/abc/my-board?x=1");
  expect(returnPath("?to=%2F%2Fevil.example%2Fb%2Fabc", origin)).toBe("/");
  expect(returnPath("?to=https%3A%2F%2Fevil.example%2F", origin)).toBe("/");
  expect(returnPath("", origin)).toBe("/");
});
