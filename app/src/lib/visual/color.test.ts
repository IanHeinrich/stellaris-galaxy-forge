import { describe, expect, it } from "vitest";
import { toCss } from "./color";

describe("toCss", () => {
  it("writes six hex digits", () => {
    expect(toCss(0x4ade80)).toBe("#4ade80");
    expect(toCss(0x0000ff)).toBe("#0000ff");
  });
});
