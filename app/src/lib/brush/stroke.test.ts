import { describe, expect, it } from "vitest";
import { seeded } from "../random";
import { inStroke } from "../../test/brush";
import { stampsAlong, STAMP_STEP } from "./stroke";

describe("seeded", () => {
  it("repeats its sequence for a seed and differs across seeds", () => {
    const a = seeded(42);
    const b = seeded(42);
    const c = seeded(43);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("stampsAlong", () => {
  it("starts a drag with one stamp and spaces the rest at most r/4 apart, ending on the pointer", () => {
    expect(stampsAlong(null, { x: 3, y: 4 }, 20)).toEqual([{ x: 3, y: 4 }]);
    const stamps = stampsAlong({ x: 0, y: 0 }, { x: 22, y: 0 }, 20);
    expect(stamps).toHaveLength(5);
    expect(stamps[stamps.length - 1]).toEqual({ x: 22, y: 0 });
    let prev = { x: 0, y: 0 };
    for (const s of stamps) {
      expect(Math.hypot(s.x - prev.x, s.y - prev.y)).toBeLessThanOrEqual(20 * STAMP_STEP + 1e-9);
      prev = s;
    }
    expect(stampsAlong({ x: 1, y: 1 }, { x: 1, y: 1 }, 20)).toEqual([]);
  });

  it("covers the swept capsule, edge included", () => {
    const stamps = [{ x: 0, y: 0 }, ...stampsAlong({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)];
    expect(inStroke({ x: 50, y: 9.5 }, stamps, 10)).toBe(true);
    expect(inStroke({ x: 110, y: 0 }, stamps, 10)).toBe(true);
    expect(inStroke({ x: 50, y: 10.5 }, stamps, 10)).toBe(false);
    expect(inStroke({ x: -10.5, y: 0 }, stamps, 10)).toBe(false);
  });
});
