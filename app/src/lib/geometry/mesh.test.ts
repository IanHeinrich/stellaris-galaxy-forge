import { describe, expect, it } from "vitest";
import { seeded } from "../random";
import { componentCount } from "./joinIslands";
import {
  betaOfDensity,
  DEFAULT_LANE_DENSITY,
  delaunayPairs,
  densityOfBeta,
  meshPairs,
  type MeshPoint,
} from "./mesh";

function grid(n: number): MeshPoint[] {
  const points: MeshPoint[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) points.push({ id: y * n + x, x, y });
  return points;
}

/** `n` points spread evenly at random over a disc of radius 500 about `centre`, ids from `first`. */
function disc(n: number, seed: number, centre = { x: 0, y: 0 }, first = 0): MeshPoint[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, (_, k) => {
    const r = 500 * Math.sqrt(rand());
    const t = 2 * Math.PI * rand();
    return { id: first + k, x: centre.x + r * Math.cos(t), y: centre.y + r * Math.sin(t) };
  });
}

/**
 * An n x n lattice `spacing` apart, square or with every other row shifted half a step into
 * triangles, off the integers so tied edges come out equal only up to rounding.
 */
function lattice(n: number, kind: "square" | "hex", spacing = 20): MeshPoint[] {
  const rowStep = kind === "square" ? spacing : (spacing * Math.sqrt(3)) / 2;
  return Array.from({ length: n * n }, (_, id) => {
    const row = Math.floor(id / n);
    const shift = kind === "hex" && row % 2 === 1 ? spacing / 2 : 0;
    return { id, x: (id % n) * spacing + shift + 0.37, y: row * rowStep - 1.1 };
  });
}

function keys(pairs: Array<[number, number]>): Set<string> {
  return new Set(pairs.map(([a, b]) => `${a}-${b}`));
}

const SQUARE_WITH_CENTRE: MeshPoint[] = [
  { id: 10, x: 0, y: 0 },
  { id: 11, x: 1, y: 0 },
  { id: 12, x: 1, y: 1 },
  { id: 13, x: 0, y: 1 },
  { id: 14, x: 0.5, y: 0.5 },
];

describe("meshPairs", () => {
  it("chains degenerate input: two points give one edge, collinear points a path", () => {
    expect(meshPairs([], 0.5)).toEqual([]);
    expect(meshPairs([{ id: 7, x: 0, y: 0 }], 0.5)).toEqual([]);
    expect(
      meshPairs(
        [
          { id: 9, x: 5, y: 5 },
          { id: 3, x: 0, y: 0 },
        ],
        0.5,
      ),
    ).toEqual([[3, 9]]);
    const line = [0, 1, 2, 3].map((k) => ({ id: 20 + k, x: k * 3, y: k }));
    for (const density of [0, 1]) {
      expect(meshPairs(line, density)).toEqual([
        [20, 21],
        [21, 22],
        [22, 23],
      ]);
    }
  });

  it("on a square with a centre point keeps only the spokes at 0 and all eight edges at 1", () => {
    expect(meshPairs(SQUARE_WITH_CENTRE, 0)).toEqual([
      [10, 14],
      [11, 14],
      [12, 14],
      [13, 14],
    ]);
    expect(meshPairs(SQUARE_WITH_CENTRE, 1)).toHaveLength(8);
  });

  it("returns ordered pairs without duplicates over known ids", () => {
    const points = [...grid(4), { id: 99, x: 1.3, y: 2.6 }];
    const ids = new Set(points.map((p) => p.id));
    for (const density of [0, 0.5, 1]) {
      const pairs = meshPairs(points, density);
      const keys = new Set(pairs.map(([a, b]) => `${a}-${b}`));
      expect(keys.size).toBe(pairs.length);
      for (const [a, b] of pairs) {
        expect(a).toBeLessThan(b);
        expect(ids.has(a) && ids.has(b)).toBe(true);
      }
    }
  });

  it("over a random spread runs from a spanning tree to every Delaunay edge in even steps", () => {
    const points = disc(500, 1);
    const tree = meshPairs(points, 0);
    expect(tree).toHaveLength(points.length - 1);
    expect(componentCount(points, tree)).toBe(1);
    expect(meshPairs(points, 1)).toEqual(delaunayPairs(points));

    const steps = [0, 0.25, 0.5, 0.75, 1].map((density) => meshPairs(points, density));
    const counts = steps.map((pairs) => pairs.length);
    const total = counts[4] - counts[0];
    for (let k = 1; k < steps.length; k++) {
      const kept = keys(steps[k]);
      expect(steps[k - 1].every(([a, b]) => kept.has(`${a}-${b}`))).toBe(true);
      expect(counts[k]).toBeGreaterThan(counts[k - 1]);
      expect(counts[k] - counts[k - 1]).toBeLessThanOrEqual(total / 2);
    }
  });

  it("keeps or drops a lattice's tied edges together", () => {
    const square = lattice(10, "square");
    const at = new Map(square.map((p) => [p.id, p]));
    const sides = (pairs: Array<[number, number]>) =>
      pairs.filter(
        ([a, b]) =>
          Math.abs(at.get(a)!.x - at.get(b)!.x) < 1e-6 ||
          Math.abs(at.get(a)!.y - at.get(b)!.y) < 1e-6,
      );
    const cells = 9 * 9;
    // The Gabriel graph keeps each cell's diagonal, whose corners lie on its circle.
    for (const [density, diagonals] of [
      [0.1, 0],
      [0.3, 0],
      [DEFAULT_LANE_DENSITY, cells],
      [0.8, cells],
    ]) {
      const pairs = meshPairs(square, density);
      expect(sides(pairs)).toHaveLength(2 * 10 * 9);
      expect(pairs.length - 2 * 10 * 9).toBe(diagonals);
    }

    const hex = lattice(10, "hex");
    const near = (a: MeshPoint, b: MeshPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 20 * 1.001;
    const sidesOfHex = hex.flatMap((a) =>
      hex.filter((b) => a.id < b.id && near(a, b)).map((b): [number, number] => [a.id, b.id]),
    );
    for (const density of [0.3, DEFAULT_LANE_DENSITY]) {
      const kept = keys(meshPairs(hex, density));
      expect(sidesOfHex.every(([a, b]) => kept.has(`${a}-${b}`))).toBe(true);
    }
    expect(meshPairs(hex, 0.1)).toHaveLength(hex.length - 1);
  });

  it("keeps the same lanes in one place when points are added far away", () => {
    const here = disc(200, 2);
    const there = disc(50, 3, { x: 20000, y: 0 }, 1000);
    for (const density of [0, 0.25, DEFAULT_LANE_DENSITY, 0.75, 1]) {
      const alone = meshPairs(here, density);
      const together = meshPairs([...here, ...there], density).filter(([, b]) => b < 1000);
      expect(together).toEqual(alone);
    }
  });
});

describe("betaOfDensity", () => {
  it("cuts at the Gabriel graph by default, falls as density rises and inverts densityOfBeta", () => {
    expect(betaOfDensity(0)).toBe(Infinity);
    expect(betaOfDensity(1)).toBe(0);
    expect(betaOfDensity(DEFAULT_LANE_DENSITY)).toBeCloseTo(1, 12);
    for (let d = 0.01; d < 1; d += 0.01) {
      expect(betaOfDensity(d)).toBeLessThan(betaOfDensity(d - 0.01));
      expect(densityOfBeta(betaOfDensity(d))).toBeCloseTo(d, 9);
    }
  });
});
