import { describe, expect, it } from "vitest";
import {
  composed,
  copies,
  guideLines,
  imageOf,
  images,
  imagesOfStamps,
  type Symmetry,
} from "./symmetry";

const SYMMETRIES: Symmetry[] = [
  { kind: "off" },
  { kind: "mirror", axis: "x" },
  { kind: "mirror", axis: "y" },
  { kind: "rotate", n: 2 },
  { kind: "rotate", n: 3 },
  { kind: "rotate", n: 4 },
  { kind: "rotate", n: 6 },
  { kind: "rotate", n: 8 },
];

describe("images", () => {
  it("puts the point first and follows the stated conventions", () => {
    const p = { x: 3, y: 4 };
    expect(images(p, { kind: "off" })).toEqual([p]);
    expect(images(p, { kind: "mirror", axis: "x" })).toEqual([p, { x: 3, y: -4 }]);
    expect(images(p, { kind: "mirror", axis: "y" })).toEqual([p, { x: -3, y: 4 }]);
    expect(images(p, { kind: "rotate", n: 4 })).toEqual([
      p,
      { x: -4, y: 3 },
      { x: -3, y: -4 },
      { x: 4, y: -3 },
    ]);
    expect(imagesOfStamps([p, { x: 1, y: 0 }], { kind: "rotate", n: 2 })).toEqual([
      [p, { x: 1, y: 0 }],
      [
        { x: -3, y: -4 },
        { x: -1, y: 0 },
      ],
    ]);
  });
});

describe("composing copies", () => {
  it("lands image m of a point in copy k in the copy of both turns, or of both reflections", () => {
    const p = { x: 3, y: 4 };
    for (const sym of SYMMETRIES) {
      for (let k = 0; k < copies(sym); k++) {
        for (let m = 0; m < copies(sym); m++) {
          const q = imageOf(imageOf(p, sym, k), sym, m);
          const r = imageOf(p, sym, composed(sym, m, k));
          expect(q.x).toBeCloseTo(r.x, 9);
          expect(q.y).toBeCloseTo(r.y, 9);
        }
      }
    }
  });
});

describe("guide lines", () => {
  it("draw a mirror's axis through the centre and a rotation's spokes out from it", () => {
    expect(guideLines({ kind: "off" }, 100)).toEqual([]);
    expect(guideLines({ kind: "mirror", axis: "x" }, 100)).toEqual([
      [
        { x: -100, y: 0 },
        { x: 100, y: 0 },
      ],
    ]);
    expect(guideLines({ kind: "mirror", axis: "y" }, 100)).toEqual([
      [
        { x: 0, y: -100 },
        { x: 0, y: 100 },
      ],
    ]);
    const o = { x: 0, y: 0 };
    expect(guideLines({ kind: "rotate", n: 4 }, 100)).toEqual([
      [o, { x: 100, y: 0 }],
      [o, { x: 0, y: 100 }],
      [o, { x: -100, y: 0 }],
      [o, { x: 0, y: -100 }],
    ]);
    const spokes = guideLines({ kind: "rotate", n: 6 }, 100);
    expect(spokes).toHaveLength(6);
    for (const [from, to] of spokes) {
      expect(from).toEqual(o);
      expect(Math.hypot(to.x, to.y)).toBeCloseTo(100, 9);
    }
  });
});
