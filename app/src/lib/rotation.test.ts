import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry/geometry";
import { rotateAbout } from "./geometry/rotate";
import { ROTATE_TURNS, rotationPivot, rotationPreview } from "./rotation";

describe("rotationPreview", () => {
  it("gives the positions as the file writes them, about their centroid without a pivot", () => {
    const systems = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 1, y: 0 }],
    ]);
    const state = { selection: [1, 2], rotatePivot: null, rotateNebulae: false };
    const preview = rotationPreview(state, { systems }, 30)!;
    expect(preview.pivot).toEqual({ x: 0.5, y: 0 });
    expect(preview.systems).toEqual([
      { system: 1, x: 0.06699, y: 0.25 },
      { system: 2, x: 0.93301, y: -0.25 },
    ]);
  });

  it("turns about the mean of the systems, not the centre of their box, until a pivot is placed", () => {
    const systems = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 3, y: 0 }],
      [3, { x: 0, y: 3 }],
    ]);
    expect(rotationPivot({ selection: [1, 2, 3], rotatePivot: null }, systems)).toEqual({
      x: 1,
      y: 1,
    });
    expect(rotationPivot({ selection: [1, 2, 3], rotatePivot: { x: 9, y: 9 } }, systems)).toEqual({
      x: 9,
      y: 9,
    });
  });
});

describe("the Rotate section's turns", () => {
  it("send screen-right to screen-down for 90° right, up for 90° left, and left for 180°", () => {
    const right = { x: SAVE_X_SIGN * 10, y: 0 };
    const lands = Object.fromEntries(
      ROTATE_TURNS.map(({ label, degrees }) => {
        const p = rotateAbout(right, { x: 0, y: 0 }, degrees);
        return [label, { x: Math.round(p.x) || 0, y: Math.round(p.y) || 0 }];
      }),
    );
    expect(lands).toEqual({
      "90° left": { x: 0, y: -SAVE_Y_SIGN * 10 },
      "90° right": { x: 0, y: SAVE_Y_SIGN * 10 },
      "180°": { x: -SAVE_X_SIGN * 10, y: 0 },
    });
  });
});
