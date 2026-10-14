import { describe, expect, it } from "vitest";
import type { Rect } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import { lattice, scatterPattern, TILE_SPACINGS } from "./fills";
import type { ShapeFrame } from "./frame";

const FRAME: ShapeFrame = { origin: { x: 13, y: -7 }, rotation: 20 };

function box(half: number, at: Pt = FRAME.origin): Rect {
  return { x0: at.x - half, y0: at.y - half, x1: at.x + half, y1: at.y + half };
}

function closest(points: readonly Pt[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return min;
}

const keyOf = (p: Pt) => `${p.x},${p.y}`;
const near = (p: Pt) => Math.hypot(p.x - FRAME.origin.x, p.y - FRAME.origin.y);

describe("scatterPattern", () => {
  const SPACING = 10;

  it("keeps its spacing across the seams between tiles, and gives points nearest the origin first", () => {
    const points = [...scatterPattern(4, SPACING, FRAME, box(3 * TILE_SPACINGS * SPACING))];
    expect(points.length).toBeGreaterThan(1000);
    expect(closest(points)).toBeGreaterThanOrEqual(SPACING);
    const d = points.map(near);
    expect(d.every((v, i) => i === 0 || v >= d[i - 1])).toBe(true);
  });

  it("keeps every point of a smaller box in a larger one, and reads only as far as asked", () => {
    const small = [...scatterPattern(4, SPACING, FRAME, box(60))];
    const large = new Set([...scatterPattern(4, SPACING, FRAME, box(250))].map(keyOf));
    expect(small.filter((p) => !large.has(keyOf(p)))).toEqual([]);
    const first = scatterPattern(4, SPACING, FRAME, box(5000)).next().value as Pt;
    expect(near(first)).toBe(Math.min(...small.map(near)));
  });

  it("gives the same pattern each time it is read, whatever was read in between", () => {
    const read = () => [...scatterPattern(4, SPACING, FRAME, box(120))];
    const first = read();
    expect(read()).toEqual(first);
    for (let k = 1; k <= 12; k++) scatterPattern(4 + k, SPACING + k, FRAME, box(30)).next();
    expect(read()).toEqual(first);
  });

  it("moves with its frame", () => {
    const by = { x: 31, y: -12 };
    const moved = { ...FRAME, origin: { x: FRAME.origin.x + by.x, y: FRAME.origin.y + by.y } };
    const here = [...scatterPattern(9, SPACING, FRAME, box(80))].filter((p) => near(p) < 70);
    const there = [...scatterPattern(9, SPACING, moved, box(80, moved.origin))];
    for (const p of here) {
      expect(there.some((q) => Math.hypot(q.x - p.x - by.x, q.y - p.y - by.y) < 1e-6)).toBe(true);
    }
  });
});

describe("lattice", () => {
  it.each(["square", "hex"] as const)(
    "puts a %s lattice's points a spacing apart, one on the origin, each once",
    (kind) => {
      const points = [...lattice(kind, 10, FRAME, box(200))];
      expect(points[0]).toEqual(FRAME.origin);
      expect(closest(points)).toBeCloseTo(10);
      expect(new Set(points.map(keyOf)).size).toBe(points.length);
      const area = 400 * 400;
      const cell = kind === "hex" ? (100 * Math.sqrt(3)) / 2 : 100;
      expect(points.length / (area / cell)).toBeCloseTo(1, 1);
    },
  );
});
