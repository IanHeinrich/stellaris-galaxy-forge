import { describe, expect, it } from "vitest";
import { choiceOf, ERASE_TARGET_CHOICES, LANE_MODE_CHOICES } from "./toolCopy";

describe("a drop-down's text", () => {
  it("reads back as its value, and nothing else", () => {
    expect(choiceOf(LANE_MODE_CHOICES, "nearby")).toBe("nearby");
    expect(choiceOf(ERASE_TARGET_CHOICES, "lanes")).toBe("lanes");
    expect(choiceOf(LANE_MODE_CHOICES, "everywhere")).toBeNull();
    expect(choiceOf(ERASE_TARGET_CHOICES, "")).toBeNull();
  });
});
