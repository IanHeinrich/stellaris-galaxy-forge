import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry";
import { convexHull, inConvexHull, rotateAbout } from "./rotate";

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

describe("the selection's hull", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("holds the points inside and on its edge, not those outside", () => {
    const hull = convexHull(square);
    expect(hull).toHaveLength(4);
    expect(inConvexHull({ x: 5, y: 5 }, hull)).toBe(true);
    expect(inConvexHull({ x: 10, y: 4 }, hull)).toBe(true);
    expect(inConvexHull({ x: 0, y: 10 }, hull)).toBe(true);
    expect(inConvexHull({ x: 10.1, y: 4 }, hull)).toBe(false);
    expect(inConvexHull({ x: -1, y: -1 }, hull)).toBe(false);
  });

  it("is a segment for two systems or a row of them", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(inConvexHull({ x: 4, y: 0 }, hull)).toBe(true);
    expect(inConvexHull({ x: 4, y: 1 }, hull)).toBe(false);
    expect(inConvexHull({ x: 11, y: 0 }, hull)).toBe(false);
  });
});
