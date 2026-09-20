import { describe, expect, it } from "vitest";
import { convexHull, expandPolygon, type Pt } from "./hull";

const SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function centroid(points: Pt[]): Pt {
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x, y };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("convexHull", () => {
  it("of a square plus interior points is the 4 corners in CCW order", () => {
    const points = [...SQUARE, { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.7 }];
    expect(convexHull(points)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });

  it("of collinear points gives the two ends", () => {
    const line = [0, 1, 2, 3].map((k) => ({ x: k, y: k }));
    expect(convexHull(line)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it("returns 1–2 points as-is", () => {
    expect(convexHull([{ x: 5, y: 5 }])).toEqual([{ x: 5, y: 5 }]);
    expect(
      convexHull([
        { x: 5, y: 5 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([
      { x: 5, y: 5 },
      { x: 1, y: 1 },
    ]);
  });
});

describe("expandPolygon", () => {
  it("of a unit square by 1 moves every vertex farther from the centroid", () => {
    const c = centroid(SQUARE);
    const expanded = expandPolygon(SQUARE, 1);
    SQUARE.forEach((p, i) => {
      expect(dist(expanded[i], c)).toBeGreaterThan(dist(p, c));
    });
  });
});
