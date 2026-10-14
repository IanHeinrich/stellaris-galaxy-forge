import { describe, expect, it } from "vitest";
import { seeded } from "../random";
import { islandLanes } from "./islandLanes";
import { componentCount } from "./joinIslands";
import { DEFAULT_LANE_DENSITY, delaunayPairs, type MeshPoint } from "./mesh";
import type { Pair } from "./pairs";
import { segmentsCross } from "./segments";

/** About `n` points at least `gap` apart over a disc of radius 500, thrown at random and kept where they fit. */
function evenDisc(n: number, gap: number, seed: number): MeshPoint[] {
  const rand = seeded(seed);
  const points: MeshPoint[] = [];
  for (let tries = 0; points.length < n && tries < n * 200; tries++) {
    const r = 500 * Math.sqrt(rand());
    const t = 2 * Math.PI * rand();
    const p = { id: points.length + 1, x: r * Math.cos(t), y: r * Math.sin(t) };
    if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= gap)) points.push(p);
  }
  return points;
}

function degrees(points: readonly MeshPoint[], pairs: readonly Pair[]): number[] {
  const degree = new Map(points.map((p) => [p.id, 0]));
  for (const [a, b] of pairs) {
    degree.set(a, degree.get(a)! + 1);
    degree.set(b, degree.get(b)! + 1);
  }
  return [...degree.values()];
}

function crossings(points: readonly MeshPoint[], pairs: readonly Pair[]): number {
  const at = new Map(points.map((p) => [p.id, p]));
  let count = 0;
  for (let k = 0; k < pairs.length; k++) {
    for (let l = k + 1; l < pairs.length; l++) {
      const [a, b] = pairs[k];
      const [c, d] = pairs[l];
      if (segmentsCross(at.get(a)!, at.get(b)!, at.get(c)!, at.get(d)!)) count++;
    }
  }
  return count;
}

const POINTS = evenDisc(400, 30, 11);

describe("islandLanes", () => {
  it("links even points about as densely as the game, in islands of 4 to 15 joined into one", () => {
    expect(POINTS.length).toBeGreaterThan(300);
    for (const seed of [1, 2, 3]) {
      const { pairs, islands } = islandLanes(POINTS, DEFAULT_LANE_DENSITY, seed);
      const degree = degrees(POINTS, pairs);
      const mean = degree.reduce((s, d) => s + d, 0) / degree.length;
      expect(mean).toBeGreaterThan(2.6);
      expect(mean).toBeLessThan(3.1);
      for (const island of islands) {
        expect(island.length).toBeGreaterThanOrEqual(4);
        expect(island.length).toBeLessThanOrEqual(15);
      }
      expect(crossings(POINTS, pairs)).toBe(0);
      expect(componentCount(POINTS, pairs)).toBe(1);
    }
  });

  it("draws the same lanes for the same seed, and others for another", () => {
    const once = islandLanes(POINTS, DEFAULT_LANE_DENSITY, 4);
    expect(islandLanes(POINTS, DEFAULT_LANE_DENSITY, 4)).toEqual(once);
    expect(islandLanes(POINTS, DEFAULT_LANE_DENSITY, 5).pairs).not.toEqual(once.pairs);
  });

  it("keeps more lanes inside each island as the Lane density rises, and the same islands", () => {
    const at = (density: number) => islandLanes(POINTS, density, 1);
    const [sparse, usual, dense] = [0, DEFAULT_LANE_DENSITY, 1].map(at);
    expect(sparse.islands).toEqual(usual.islands);
    expect(dense.islands).toEqual(usual.islands);
    expect(sparse.pairs.length).toBeLessThan(usual.pairs.length);
    expect(usual.pairs.length).toBeLessThan(dense.pairs.length);
  });

  it("lays only the edges it may", () => {
    const short = (p: MeshPoint, q: MeshPoint) => Math.hypot(p.x - q.x, p.y - q.y) <= 45;
    const at = new Map(POINTS.map((p) => [p.id, p]));
    const { pairs } = islandLanes(POINTS, DEFAULT_LANE_DENSITY, 1, short);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) expect(short(at.get(a)!, at.get(b)!)).toBe(true);
  });

  it("leaves no system with fewer than 2 lanes in its island where the triangulation gave it 2", () => {
    for (const density of [0, DEFAULT_LANE_DENSITY]) {
      const { pairs, islands } = islandLanes(POINTS, density, 2);
      const of = new Map(islands.flatMap((ids, k) => ids.map((id) => [id, k])));
      const count = (list: readonly Pair[]) => {
        const degree = new Map<number, number>();
        for (const [a, b] of list) {
          if (of.get(a) !== of.get(b)) continue;
          degree.set(a, (degree.get(a) ?? 0) + 1);
          degree.set(b, (degree.get(b) ?? 0) + 1);
        }
        return degree;
      };
      const offered = count(delaunayPairs(POINTS));
      const laid = count(pairs);
      for (const [id, n] of offered) {
        if (n >= 2) expect(laid.get(id) ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("links a few points, or points in a row, as one chain", () => {
    const at = (...xy: Array<[number, number]>): MeshPoint[] =>
      xy.map(([x, y], k) => ({ id: k + 1, x, y }));
    expect(islandLanes([], DEFAULT_LANE_DENSITY, 1)).toEqual({ pairs: [], islands: [] });
    expect(islandLanes(at([0, 0]), DEFAULT_LANE_DENSITY, 1)).toEqual({ pairs: [], islands: [[1]] });
    expect(islandLanes(at([0, 0], [10, 0]), DEFAULT_LANE_DENSITY, 1).pairs).toEqual([[1, 2]]);
    const triangle = at([0, 0], [10, 0], [5, 8]);
    expect(islandLanes(triangle, DEFAULT_LANE_DENSITY, 1).pairs).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    const row = at([0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0]);
    for (const seed of [1, 2, 3]) {
      expect(islandLanes(row, DEFAULT_LANE_DENSITY, seed).pairs).toEqual([
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
      ]);
    }
  });
});
