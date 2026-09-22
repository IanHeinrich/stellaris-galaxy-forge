import { describe, expect, it } from "vitest";
import { betaOfSlider, MESH_BETA, meshPairs, sliderOfBeta, type MeshPoint } from "./mesh";

function grid(n: number): MeshPoint[] {
  const points: MeshPoint[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) points.push({ id: y * n + x, x, y });
  return points;
}

function axisAligned(points: MeshPoint[], pairs: Array<[number, number]>): boolean {
  const at = new Map(points.map((p) => [p.id, p]));
  return pairs.every(([a, b]) => at.get(a)!.x === at.get(b)!.x || at.get(a)!.y === at.get(b)!.y);
}

const SQUARE_WITH_CENTRE: MeshPoint[] = [
  { id: 10, x: 0, y: 0 },
  { id: 11, x: 1, y: 0 },
  { id: 12, x: 1, y: 1 },
  { id: 13, x: 0, y: 1 },
  { id: 14, x: 0.5, y: 0.5 },
];

describe("meshPairs", () => {
  it("on a 3x3 grid gives the 12 axis-aligned edges at beta=2 and adds the diagonals as beta falls", () => {
    const points = grid(3);
    const sparse = meshPairs(points, MESH_BETA.sparse);
    expect(sparse).toHaveLength(12);
    expect(axisAligned(points, sparse)).toBe(true);
    // The cell corners lie on the diagonal's Gabriel circle, not strictly inside it.
    const gabriel = meshPairs(points, MESH_BETA.gabriel);
    expect(gabriel).toHaveLength(16);
    expect(gabriel.filter((e) => axisAligned(points, [e]))).toHaveLength(12);
    expect(meshPairs(points, MESH_BETA.dense)).toHaveLength(16);
  });

  it("chains degenerate input: two points give one edge, collinear points a path", () => {
    expect(meshPairs([], 1)).toEqual([]);
    expect(meshPairs([{ id: 7, x: 0, y: 0 }], 1)).toEqual([]);
    expect(
      meshPairs(
        [
          { id: 9, x: 5, y: 5 },
          { id: 3, x: 0, y: 0 },
        ],
        1,
      ),
    ).toEqual([[3, 9]]);
    const line = [0, 1, 2, 3].map((k) => ({ id: 20 + k, x: k * 3, y: k }));
    expect(meshPairs(line, 2)).toEqual([
      [20, 21],
      [21, 22],
      [22, 23],
    ]);
  });

  it("on a square with a centre point keeps only the spokes at beta=2 and all eight edges at beta=1", () => {
    const spokes = meshPairs(SQUARE_WITH_CENTRE, MESH_BETA.sparse);
    expect(spokes).toEqual([
      [10, 14],
      [11, 14],
      [12, 14],
      [13, 14],
    ]);
    expect(meshPairs(SQUARE_WITH_CENTRE, MESH_BETA.gabriel)).toHaveLength(8);
  });

  it("returns ordered pairs without duplicates over known ids", () => {
    const points = [...grid(4), { id: 99, x: 1.3, y: 2.6 }];
    const ids = new Set(points.map((p) => p.id));
    for (const beta of [MESH_BETA.sparse, MESH_BETA.gabriel, 0.5, MESH_BETA.dense]) {
      const pairs = meshPairs(points, beta);
      const keys = new Set(pairs.map(([a, b]) => `${a}-${b}`));
      expect(keys.size).toBe(pairs.length);
      for (const [a, b] of pairs) {
        expect(a).toBeLessThan(b);
        expect(ids.has(a) && ids.has(b)).toBe(true);
      }
    }
  });
});

describe("betaOfSlider", () => {
  it("runs sparse to dense, puts the Gabriel graph mid-slider and inverts sliderOfBeta", () => {
    expect(betaOfSlider(0)).toBe(MESH_BETA.sparse);
    expect(betaOfSlider(1)).toBe(MESH_BETA.dense);
    expect(sliderOfBeta(MESH_BETA.gabriel)).toBeCloseTo(0.2314, 4);
    for (const v of [0.1, 0.5, 0.9]) expect(sliderOfBeta(betaOfSlider(v))).toBeCloseTo(v, 12);
  });
});
