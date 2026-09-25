import { afterEach, describe, expect, test, vi } from "vitest";
import { finishDraft, startDraft } from "./stroke";

describe("finishDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("commits a stroke outside a secure context, where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const draft = startDraft(0, "Medium", 1);
    draft.points.push([10, 10, 0.5], [40, 20, 0.5]);
    const stored = finishDraft(draft);
    expect(stored?.object.objectId).toMatch(/^[0-9a-z]{9}[0-9a-f]{12}$/);
  });
});
