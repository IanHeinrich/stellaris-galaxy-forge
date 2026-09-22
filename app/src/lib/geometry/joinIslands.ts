import { cellKey } from "../spatialGrid";
import { MESH_BETA, meshPairs, type MeshPoint } from "./mesh";
import type { Pt } from "./pt";

/** Side of the cells a `SegmentIndex` buckets by, in world units: about one lane. */
export const SEGMENT_CELL = 50;

/** How many nearest points in other components each point offers once the triangulation runs out. */
export const FALLBACK_NEIGHBOURS = 8;

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether segments ab and cd cross at a point interior to both; touching or sharing an end is not a crossing. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

/** Segments bucketed by the grid cells their bounding boxes cover, for crossing queries. */
export class SegmentIndex {
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly segments: Array<[Pt, Pt]> = [];
  private readonly seen: number[] = [];
  private query = 0;

  constructor(cell = SEGMENT_CELL) {
    this.cell = cell;
  }

  add(a: Pt, b: Pt): void {
    const i = this.segments.length;
    this.segments.push([a, b]);
    this.seen.push(0);
    this.forEachCell(a, b, (k) => {
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(i);
      else this.cells.set(k, [i]);
    });
  }

  crosses(a: Pt, b: Pt): boolean {
    const query = ++this.query;
    let hit = false;
    this.forEachCell(a, b, (k) => {
      if (hit) return;
      for (const i of this.cells.get(k) ?? []) {
        if (this.seen[i] === query) continue;
        this.seen[i] = query;
        const [c, d] = this.segments[i];
        if (segmentsCross(a, b, c, d)) {
          hit = true;
          return;
        }
      }
    });
    return hit;
  }

  private forEachCell(a: Pt, b: Pt, fn: (key: number) => void): void {
    const x0 = Math.floor(Math.min(a.x, b.x) / this.cell);
    const x1 = Math.floor(Math.max(a.x, b.x) / this.cell);
    const y0 = Math.floor(Math.min(a.y, b.y) / this.cell);
    const y1 = Math.floor(Math.max(a.y, b.y) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) fn(cellKey(i, j));
  }
}

class UnionFind {
  private readonly parent: number[];
  components: number;

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.components = n;
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(i: number, j: number): boolean {
    const a = this.find(i);
    const b = this.find(j);
    if (a === b) return false;
    this.parent[a] = b;
    this.components--;
    return true;
  }
}

/** How many connected components `edges` leave `points` in; an edge to a point not listed is skipped. */
export function componentCount(
  points: readonly MeshPoint[],
  edges: readonly (readonly [number, number])[],
): number {
  const indexOf = new Map(points.map((p, i) => [p.id, i]));
  const uf = new UnionFind(points.length);
  for (const [a, b] of edges) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i !== undefined && j !== undefined) uf.union(i, j);
  }
  return uf.components;
}

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * The fewest new edges, shortest first, that join every connected component of `points` under
 * `edges` into one, as [id, id] pairs with a < b. No new edge crosses an existing edge or another
 * new one.
 *
 * Candidates are the Delaunay edges between different components. When crossings leave some
 * components apart, each point then offers its `FALLBACK_NEIGHBOURS` nearest points in other
 * components (an O(n²) scan, run only in that case). Components that even those cannot reach
 * without a crossing stay apart, so the result can hold fewer than components - 1 edges.
 */
export function joinIslands(
  points: readonly MeshPoint[],
  edges: readonly (readonly [number, number])[],
): Array<[number, number]> {
  const indexOf = new Map(points.map((p, i) => [p.id, i]));
  const uf = new UnionFind(points.length);
  const existing = new SegmentIndex();
  for (const [a, b] of edges) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i === undefined || j === undefined) continue;
    uf.union(i, j);
    existing.add(points[i], points[j]);
  }
  if (uf.components <= 1) return [];

  const chosen = new SegmentIndex();
  const joins: Array<[number, number]> = [];
  const consider = (candidates: Array<[number, number]>): void => {
    const length = candidates.map(([i, j]) => dist2(points[i], points[j]));
    const order = candidates.map((_, k) => k);
    const ids = candidates.map(([i, j]) => ordered(points[i].id, points[j].id));
    order.sort((k, l) => length[k] - length[l] || comparePairs(ids[k], ids[l]));
    for (const k of order) {
      if (uf.components <= 1) return;
      const [i, j] = candidates[k];
      if (uf.find(i) === uf.find(j)) continue;
      const a = points[i];
      const b = points[j];
      if (existing.crosses(a, b) || chosen.crosses(a, b)) continue;
      uf.union(i, j);
      chosen.add(a, b);
      joins.push(ids[k]);
    }
  };

  const delaunay = meshPairs([...points], MESH_BETA.dense).map(
    ([a, b]) => [indexOf.get(a)!, indexOf.get(b)!] as [number, number],
  );
  consider(delaunay.filter(([i, j]) => uf.find(i) !== uf.find(j)));
  if (uf.components > 1) consider(nearestAcross(points, uf));
  return joins.sort(comparePairs);
}

function ordered(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function comparePairs(p: [number, number], q: [number, number]): number {
  return p[0] - q[0] || p[1] - q[1];
}

/** Each point's nearest points in other components, as deduplicated index pairs. */
function nearestAcross(points: readonly MeshPoint[], uf: UnionFind): Array<[number, number]> {
  const pairs = new Map<string, [number, number]>();
  for (let i = 0; i < points.length; i++) {
    const root = uf.find(i);
    const near: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < points.length; j++) {
      if (uf.find(j) === root) continue;
      const d = dist2(points[i], points[j]);
      if (near.length === FALLBACK_NEIGHBOURS && d >= near[near.length - 1].d) continue;
      if (near.length === FALLBACK_NEIGHBOURS) near.pop();
      let at = near.length;
      while (at > 0 && near[at - 1].d > d) at--;
      near.splice(at, 0, { j, d });
    }
    for (const { j } of near) {
      const pair = ordered(i, j);
      pairs.set(`${pair[0]},${pair[1]}`, pair);
    }
  }
  return [...pairs.values()];
}
