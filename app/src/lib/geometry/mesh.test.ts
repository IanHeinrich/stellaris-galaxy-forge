import { describe, expect, it } from "vitest";
import { seeded } from "../random";
import { componentCount } from "./joinIslands";
import { delaunayPairs, meshPairs, rankedMesh, type MeshPoint } from "./mesh";

function grid(n: number): MeshPoint[] {
  const points: MeshPoint[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) points.push({ id: y * n + x, x, y });
  return points;
}

function axisAligned(points: MeshPoint[], pairs: Array<[number, number]>): boolean {
  const at = new Map(points.map((p) => [p.id, p]));
  return pairs.every(([a, b]) => at.get(a)!.x === at.get(b)!.x || at.get(a)!.y === at.get(b)!.y);
}

/** `n` points spread evenly at random over a disc. */
function disc(n: number, seed: number): MeshPoint[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, (_, id) => {
    const r = 500 * Math.sqrt(rand());
    const t = 2 * Math.PI * rand();
    return { id, x: r * Math.cos(t), y: r * Math.sin(t) };
  });
}

const SQUARE_WITH_CENTRE: MeshPoint[] = [
  { id: 10, x: 0, y: 0 },
  { id: 11, x: 1, y: 0 },
  { id: 12, x: 1, y: 1 },
  { id: 13, x: 0, y: 1 },
  { id: 14, x: 0.5, y: 0.5 },
];

describe("rankedMesh", () => {
  it("on a 3x3 grid ranks the spanning tree, then the other axis-aligned edges, then the diagonals", () => {
    const points = grid(3);
    const { pairs, tree } = rankedMesh(points);
    expect(tree).toBe(8);
    expect(pairs).toHaveLength(16);
    expect(axisAligned(points, pairs.slice(0, 12))).toBe(true);
    expect(pairs.slice(12).some((e) => axisAligned(points, [e]))).toBe(false);
  });
});

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
      const kept = new Set(steps[k].map(([a, b]) => `${a}-${b}`));
      expect(steps[k - 1].every(([a, b]) => kept.has(`${a}-${b}`))).toBe(true);
      expect(counts[k]).toBeGreaterThan(counts[k - 1]);
      expect(counts[k] - counts[k - 1]).toBeLessThanOrEqual(total / 2);
    }
  });
});
