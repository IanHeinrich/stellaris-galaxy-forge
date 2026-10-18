import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry";
import { rotateAbout } from "./rotate";

describe("rotateAbout", () => {
  it("turns clockwise as the map shows it: screen right goes to screen down", () => {
    const pivot = { x: 5, y: 5 };
    const right = { x: pivot.x + SAVE_X_SIGN * 10, y: pivot.y };
    const down = rotateAbout(right, pivot, 90);
    expect(down.x).toBeCloseTo(pivot.x);
    expect(down.y).toBeCloseTo(pivot.y + SAVE_Y_SIGN * 10);

    const back = rotateAbout(down, pivot, -90);
    expect(back.x).toBeCloseTo(right.x);
    expect(back.y).toBeCloseTo(right.y);
  });

  it("is the world's clockwise turn while the map mirrors x", () => {
    expect(SAVE_X_SIGN * SAVE_Y_SIGN).toBe(-1);
    const p = rotateAbout({ x: 0, y: 10 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });
});
