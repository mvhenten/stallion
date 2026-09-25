import { expect, test } from "vitest";
import { App } from "./app";

test("renders the app shell", () => {
  const shell = App();
  expect(shell.type).toBe("main");
  expect(shell.props.children).toBe("Stallion");
});
