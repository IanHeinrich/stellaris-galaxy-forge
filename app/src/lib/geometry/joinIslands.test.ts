import { describe, expect, it } from "vitest";
import { joinIslands } from "./joinIslands";
import type { MeshPoint } from "./mesh";
import { segmentsCross } from "./segments";

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

  it("goes around a blocked lane it was not given as an edge", () => {
    const points: MeshPoint[] = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 5, y: -30 },
    ];
    const blocked = [{ a: { x: 5, y: -10 }, b: { x: 5, y: 10 } }];
    const joins = joinIslands(points, [], { blocked });
    expect(joins).toHaveLength(2);
    expect(joins).not.toContainEqual([1, 2]);
    expect(components(points, joins)).toBe(1);
  });

  it("counts joined pairs as one island, without letting them block a lane", () => {
    const joined: [number, number][] = [
      [3, 4],
      [8, 9],
    ];
    const joins = joinIslands(POINTS, EDGES, { joined });
    expect(joins).toHaveLength(1);
    expect(components(POINTS, [...EDGES, ...joined, ...joins])).toBe(1);

    const apart: MeshPoint[] = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 5, y: -50 },
      { id: 4, x: 5, y: 50 },
    ];
    // 1–2 crosses the line from 3 to 4, which is joined but is no lane.
    expect(joinIslands(apart, [], { joined: [[3, 4]] })).toContainEqual([1, 2]);
  });
});
