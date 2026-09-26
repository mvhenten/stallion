import { expect, test } from "vitest";
import { displayName, peersOf } from "./presence";

test("the display name is the email local part, else the token name, else Guest", () => {
  expect(displayName("ada.lovelace@example.com")).toBe("ada.lovelace");
  expect(displayName("0123abcd.access")).toBe("0123abcd.access");
  expect(displayName("")).toBe("Guest");
  expect(displayName(undefined)).toBe("Guest");
  expect(displayName("@example.com")).toBe("Guest");
});

test("peers read the server-stamped name and list yourself first", () => {
  const peers = peersOf(
    new Map<number, unknown>([
      [9, { user: { name: "grace@example.com" }, presence: { viewport: { x: 1, y: 2, zoom: 4 } } }],
      [3, {}],
    ]),
    3,
  );
  expect(peers.map(({ clientId, name, self }) => ({ clientId, name, self }))).toEqual([
    { clientId: 3, name: "You", self: true },
    { clientId: 9, name: "grace", self: false },
  ]);
  expect(peers[1]?.viewport).toEqual({ x: 1, y: 2, zoom: 4 });
});
