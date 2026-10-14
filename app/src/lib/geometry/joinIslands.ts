import { delaunayPairs, type MeshPoint } from "./mesh";
import { comparePairs, pairOf, PairSet } from "./pairs";
import { dist2, type Pt } from "./pt";
import { SegmentIndex } from "./segments";
import { UnionFind } from "./unionFind";

/** How many nearest points in other components each point offers once the triangulation runs out. */
const FALLBACK_NEIGHBOURS = 8;

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

/** What else `joinIslands` takes into account beside the points' own edges. */
export interface JoinOptions {
  /** Lanes no new edge may cross, beside `edges`, such as existing lanes near the points. */
  blocked?: ReadonlyArray<{ a: Pt; b: Pt }>;
  /** Pairs of ids counted as joined already without being lanes: they join components but block nothing. */
  joined?: readonly (readonly [number, number])[];
}

/**
 * The fewest new edges, shortest first, that join every connected component of `points` under
 * `edges` and `options.joined` into one, as [id, id] pairs with a < b. No new edge crosses an
 * existing edge, a blocked lane or another new one.
 *
 * Candidates are the Delaunay edges between different components. When crossings leave some
 * components apart, each point then offers its `FALLBACK_NEIGHBOURS` nearest points in other
 * components (an O(n²) scan, run only in that case). Components that even those cannot reach
 * without a crossing stay apart, so the result can hold fewer than components - 1 edges.
 */
export function joinIslands(
  points: readonly MeshPoint[],
  edges: readonly (readonly [number, number])[],
  { blocked = [], joined = [] }: JoinOptions = {},
): Array<[number, number]> {
  const indexOf = new Map(points.map((p, i) => [p.id, i]));
  const uf = new UnionFind(points.length);
  const existing = new SegmentIndex();
  for (const { a, b } of blocked) existing.add(a, b);
  for (const [a, b] of edges) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i === undefined || j === undefined) continue;
    uf.union(i, j);
    existing.add(points[i], points[j]);
  }
  for (const [a, b] of joined) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i !== undefined && j !== undefined) uf.union(i, j);
  }
  if (uf.components <= 1) return [];

  const chosen = new SegmentIndex();
  const joins: Array<[number, number]> = [];
  const consider = (candidates: Array<[number, number]>): void => {
    const length = candidates.map(([i, j]) => dist2(points[i], points[j]));
    const order = candidates.map((_, k) => k);
    const ids = candidates.map(([i, j]) => pairOf(points[i].id, points[j].id));
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

  const delaunay = delaunayPairs(points).map(
    ([a, b]) => [indexOf.get(a)!, indexOf.get(b)!] as [number, number],
  );
  consider(delaunay.filter(([i, j]) => uf.find(i) !== uf.find(j)));
  if (uf.components > 1) consider(nearestAcross(points, uf));
  return joins.sort(comparePairs);
}

/** Each point's nearest points in other components, as deduplicated index pairs. */
function nearestAcross(points: readonly MeshPoint[], uf: UnionFind): Array<[number, number]> {
  const pairs = new PairSet();
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
    for (const { j } of near) pairs.add(i, j);
  }
  return [...pairs.values()];
}
