import { describe, expect, it } from "vitest";
import { joinIslands, SegmentIndex, segmentsCross } from "./joinIslands";
import type { MeshPoint } from "./mesh";

function components(points: readonly MeshPoint[], edges: readonly [number, number][]): number {
  const parent = new Map(points.map((p) => [p.id, p.id]));
  const find = (id: number): number => {
    while (parent.get(id) !== id) id = parent.get(id)!;
    return id;
  };
  for (const [a, b] of edges) parent.set(find(a), find(b));
  return new Set(points.map((p) => find(p.id))).size;
}

function crossings(points: readonly MeshPoint[], edges: readonly [number, number][]): number {
  const at = new Map(points.map((p) => [p.id, p]));
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i].map((id) => at.get(id)!);
      const [c, d] = edges[j].map((id) => at.get(id)!);
      if (segmentsCross(a, b, c, d)) n++;
    }
  }
  return n;
}

/** A triangle island, a square island, a lone system and a pair with a long lane across the gap. */
const POINTS: MeshPoint[] = [
  { id: 1, x: 0, y: 0 },
  { id: 2, x: 20, y: 0 },
  { id: 3, x: 10, y: 17 },
  { id: 4, x: 60, y: 0 },
  { id: 5, x: 80, y: 0 },
  { id: 6, x: 80, y: 20 },
  { id: 7, x: 60, y: 20 },
  { id: 8, x: 40, y: 50 },
  { id: 9, x: 30, y: -40 },
  { id: 10, x: 50, y: -40 },
];
const EDGES: [number, number][] = [
  [1, 2],
  [2, 3],
  [3, 1],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [9, 10],
];

describe("segmentsCross", () => {
  it("counts interior crossings only", () => {
    const o = { x: 0, y: 0 };
    expect(segmentsCross(o, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    expect(segmentsCross(o, { x: 2, y: 2 }, o, { x: 2, y: 0 })).toBe(false);
    expect(segmentsCross(o, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 })).toBe(false);
    expect(segmentsCross(o, { x: 1, y: 1 }, { x: 3, y: 0 }, { x: 3, y: 5 })).toBe(false);
  });

  it("is found through the index across cells", () => {
    const index = new SegmentIndex(10);
    index.add({ x: -100, y: 5 }, { x: 100, y: 5 });
    expect(index.crosses({ x: 50, y: 0 }, { x: 50, y: 30 })).toBe(true);
    expect(index.crosses({ x: 50, y: 10 }, { x: 60, y: 30 })).toBe(false);
  });
});

describe("joinIslands", () => {
  it("joins four islands with three lanes that cross nothing", () => {
    expect(components(POINTS, EDGES)).toBe(4);
    const joins = joinIslands(POINTS, EDGES);
    expect(joins).toHaveLength(3);
    const all = [...EDGES, ...joins];
    expect(components(POINTS, all)).toBe(1);
    expect(crossings(POINTS, all)).toBe(0);
    expect(joins.every(([a, b]) => a < b)).toBe(true);
    expect(joinIslands(POINTS, all)).toEqual([]);
  });

  it("goes around an existing lane that walls off the shortest link", () => {
    const points: MeshPoint[] = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 5, y: -30 },
      { id: 4, x: 5, y: 30 },
    ];
    const edges: [number, number][] = [[3, 4]];
    const joins = joinIslands(points, edges);
    expect(joins).toHaveLength(2);
    expect(joins).not.toContainEqual([1, 2]);
    expect(components(points, [...edges, ...joins])).toBe(1);
    expect(crossings(points, [...edges, ...joins])).toBe(0);
  });
});
