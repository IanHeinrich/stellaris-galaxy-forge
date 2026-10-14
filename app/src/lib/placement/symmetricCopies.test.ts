import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import type { Symmetry } from "../geometry/symmetry";
import { symmetricCopies } from "./symmetricCopies";

const QUARTER: Symmetry = { kind: "rotate", n: 4 };
const PIVOT = { x: 0, y: 0 };
const EAST = { x: 10, y: 0 };

/** `p` with float noise and negative zero rounded away, for comparing. */
const at = (p: Pt) => ({
  x: Math.round(p.x * 1000) / 1000 + 0,
  y: Math.round(p.y * 1000) / 1000 + 0,
});

describe("symmetric copies", () => {
  it("merges the images of a point on the pivot into it", () => {
    const { points, imageOfNew } = symmetricCopies([PIVOT, EAST], QUARTER);
    expect(points.map(at)).toEqual([
      PIVOT,
      EAST,
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
    ]);
    for (let m = 0; m < 4; m++) expect(imageOfNew(0, m)).toBe(0);
  });

  it("finds the images of an image, not only of a base point", () => {
    const { points, imageOfNew } = symmetricCopies([PIVOT, EAST], QUARTER);
    expect([1, 2, 3].map((m) => imageOfNew(2, m))).toEqual([3, 4, 1]);
    expect(at(points[imageOfNew(4, 1)!])).toEqual(EAST);
  });

  it("leaves out an image where a system already stands", () => {
    const occupied = {
      nearestSystem: (x: number, y: number, d: number) =>
        Math.hypot(x + 10, y) <= d ? { id: 99 } : null,
    };
    const { points, imageOfNew } = symmetricCopies([EAST], QUARTER, occupied);
    expect(points.map(at)).toEqual([EAST, { x: 0, y: 10 }, { x: 0, y: -10 }]);
    expect(imageOfNew(0, 2)).toBeNull();
    expect(imageOfNew(1, 1)).toBeNull();
    expect(imageOfNew(1, 2)).toBe(2);
  });
});
