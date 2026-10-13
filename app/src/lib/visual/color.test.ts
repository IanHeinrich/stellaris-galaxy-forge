import { describe, expect, it } from "vitest";
import { readableTint, toCss } from "./color";
import { NEUTRAL_RAMP } from "./resourceColors";

describe("toCss", () => {
  it("writes six hex digits", () => {
    expect(toCss(0x4ade80)).toBe("#4ade80");
    expect(toCss(0x0000ff)).toBe("#0000ff");
  });
});

describe("readableTint", () => {
  it("keeps a light colour and swaps a near-black one for the neutral tone", () => {
    expect(readableTint(0xf59e0b)).toBe("#f59e0b");
    expect(readableTint(0x050505)).toBe(NEUTRAL_RAMP[1]);
  });
});
