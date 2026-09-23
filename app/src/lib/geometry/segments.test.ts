import { describe, expect, it } from "vitest";
import { SegmentIndex, segmentsCross } from "./segments";

describe("segmentsCross", () => {
  it("counts interior crossings only", () => {
    const o = { x: 0, y: 0 };
    expect(segmentsCross(o, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    expect(segmentsCross(o, { x: 2, y: 2 }, o, { x: 2, y: 0 })).toBe(false);
    expect(segmentsCross(o, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 })).toBe(false);
    expect(segmentsCross(o, { x: 1, y: 1 }, { x: 3, y: 0 }, { x: 3, y: 5 })).toBe(false);
  });

  it("is found through the index across cells", () => {
    const index = new SegmentIndex(10);
    index.add({ x: -100, y: 5 }, { x: 100, y: 5 });
    expect(index.crosses({ x: 50, y: 0 }, { x: 50, y: 30 })).toBe(true);
    expect(index.crosses({ x: 50, y: 10 }, { x: 60, y: 30 })).toBe(false);
  });
});
