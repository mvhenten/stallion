import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NoticeState } from "./reconnect";
import { createConnectionNotice, RECONNECT_NOTICE_MS } from "./reconnect";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("reconnecting for 10s shows the bar, connected hides it", () => {
  const states: NoticeState[] = [];
  const controller = createConnectionNotice((state) => states.push(state));

  controller.onConnection("Reconnecting");
  expect(states).toEqual([]);

  vi.advanceTimersByTime(RECONNECT_NOTICE_MS - 1);
  expect(states).toEqual([]);

  vi.advanceTimersByTime(1);
  expect(states).toEqual(["Reconnecting"]);

  controller.onConnection("Connected");
  expect(states).toEqual(["Reconnecting", "None"]);
});

test("a check that resolves expired shows the notice once the redirect already ran", async () => {
  const states: NoticeState[] = [];
  const controller = createConnectionNotice(
    (state) => states.push(state),
    () => Promise.resolve(true),
    { expired: () => false, signedIn: vi.fn() },
  );

  controller.onConnection("Offline");
  await vi.advanceTimersByTimeAsync(RECONNECT_NOTICE_MS);

  expect(states).toEqual(["Reconnecting", "Expired"]);
});

test("an expired check redirects to the login instead of showing the notice", async () => {
  const states: NoticeState[] = [];
  const redirect = { expired: vi.fn(() => true), signedIn: vi.fn() };
  const controller = createConnectionNotice(
    (state) => states.push(state),
    () => Promise.resolve(true),
    redirect,
  );

  controller.onConnection("Offline");
  await vi.advanceTimersByTimeAsync(RECONNECT_NOTICE_MS);

  expect(redirect.expired).toHaveBeenCalledOnce();
  expect(states).toEqual(["Reconnecting"]);

  controller.onConnection("Connected");
  expect(redirect.signedIn).toHaveBeenCalledOnce();
});
