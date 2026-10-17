import { describe, expect, it } from "vitest";
import { rotationPreview } from "./rotation";

describe("rotationPreview", () => {
  it("gives the positions as the file writes them, about the bounds centre without a pivot", () => {
    const systems = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 1, y: 0 }],
    ]);
    const state = { selection: [1, 2], rotatePivot: null, rotateNebulae: false };
    const preview = rotationPreview(state, { systems, nebulae: [] }, 30)!;
    expect(preview.pivot).toEqual({ x: 0.5, y: 0 });
    expect(preview.systems).toEqual([
      { system: 1, x: 0.06699, y: 0.25 },
      { system: 2, x: 0.93301, y: -0.25 },
    ]);
  });
});
