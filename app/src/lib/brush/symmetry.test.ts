import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { seeded } from "./random";
import {
  copies,
  images,
  imagesOfStamps,
  symmetricPairs,
  symmetricPoints,
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

function has(points: readonly Pt[], p: Pt): boolean {
  return points.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
}

function scatter(n: number, seed: number): Pt[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, () => ({ x: rand() * 400 - 200, y: rand() * 400 - 200 }));
}

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

describe("symmetricPoints", () => {
  const SPACING = 15;
  const BLOCKERS = scatter(20, 11);

  it.each(SYMMETRIES)("is exactly symmetric and holds spacing across copies: %o", (sym) => {
    const base = scatter(200, 3);
    const { base: kept, points } = symmetricPoints(base, sym, SPACING, BLOCKERS);
    expect(kept.length).toBeGreaterThan(0);
    expect(points).toHaveLength(kept.length * copies(sym));
    for (const p of points) for (const q of images(p, sym)) expect(has(points, q)).toBe(true);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(d).toBeGreaterThanOrEqual(SPACING);
      }
      for (const b of BLOCKERS) {
        expect(Math.hypot(points[i].x - b.x, points[i].y - b.y)).toBeGreaterThanOrEqual(SPACING);
      }
    }
  });

  it("drops base points whose images crowd each other at the centre or on the mirror axis", () => {
    const base = [
      { x: 1, y: 1 },
      { x: 50, y: 3 },
      { x: 50, y: 40 },
    ];
    expect(symmetricPoints(base, { kind: "mirror", axis: "x" }, 10, []).base).toEqual([
      { x: 50, y: 40 },
    ]);
    expect(symmetricPoints(base, { kind: "rotate", n: 6 }, 10, []).base).toEqual(base.slice(1));
  });
});

describe("symmetricPairs", () => {
  it("maps copy 0's lanes onto every copy, deduplicated", () => {
    expect(
      symmetricPairs(
        [
          [1, 0],
          [0, 1],
          [1, 2],
        ],
        3,
        { kind: "rotate", n: 3 },
      ),
    ).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [6, 7],
      [7, 8],
    ]);
  });

  it("lands mirrored lanes between mirrored points", () => {
    const sym: Symmetry = { kind: "mirror", axis: "y" };
    const { base, points } = symmetricPoints(
      [
        { x: 20, y: 0 },
        { x: 40, y: 10 },
      ],
      sym,
      5,
      [],
    );
    const [[a, b]] = symmetricPairs([[0, 1]], base.length, sym).slice(1);
    expect(points[a]).toEqual({ x: -20, y: 0 });
    expect(points[b]).toEqual({ x: -40, y: 10 });
  });
});
