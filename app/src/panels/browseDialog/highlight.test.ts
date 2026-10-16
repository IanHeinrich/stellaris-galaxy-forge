import { describe, expect, it } from "vitest";
import { fallbackHighlight } from "./highlight";

describe("fallbackHighlight", () => {
  it("keeps a highlighted row the list shows", () => {
    expect(fallbackHighlight(["a", "b"], "b")).toBe(null);
  });

  it("moves to the first row off one it does not, or from none", () => {
    expect(fallbackHighlight(["a", "b"], "c")).toBe("a");
    expect(fallbackHighlight(["a", "b"], null)).toBe("a");
  });

  it("leaves the highlight alone on an empty list", () => {
    expect(fallbackHighlight([], "c")).toBe(null);
    expect(fallbackHighlight([], null)).toBe(null);
  });
});
