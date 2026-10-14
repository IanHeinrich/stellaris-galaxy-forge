import { describe, expect, it } from "vitest";
import { seeded } from "../random";
import { islandLanes } from "./islandLanes";
import { componentCount } from "./joinIslands";
import { DEFAULT_LANE_DENSITY, type MeshPoint } from "./mesh";
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
});
