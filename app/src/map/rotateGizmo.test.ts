import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN } from "../lib/geometry/geometry";
import { rotateAbout } from "../lib/geometry/rotate";
import { dragTurn } from "./rotateGizmo";

describe("dragTurn", () => {
  const pivot = { x: 0, y: 0 };
  /** A press screen-right of the pivot, dragged round it by `degrees` clockwise on screen. */
  const turned = (degrees: number, snap = false) => {
    const from = { x: SAVE_X_SIGN * 10, y: 0 };
    return dragTurn(pivot, from, rotateAbout(from, pivot, degrees), snap);
  };

  it("reads clockwise on screen as positive, and goes the short way round", () => {
    expect(turned(30)).toBeCloseTo(30);
    expect(turned(-30)).toBeCloseTo(-30);
    expect(turned(270)).toBeCloseTo(-90);
    expect(turned(-200)).toBeCloseTo(160);
  });

  it("snaps to 15° with Shift, a half turn to 180 from either side", () => {
    expect(turned(50, true)).toBe(45);
    expect(turned(-52.6, true)).toBe(-60);
    expect(turned(179, true)).toBe(180);
    expect(turned(-179, true)).toBe(180);
    expect(turned(180)).toBeCloseTo(180);
  });
});
