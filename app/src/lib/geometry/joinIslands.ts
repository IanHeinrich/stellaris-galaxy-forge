import { delaunayPairs, type MeshPoint } from "./mesh";
import { comparePairs, pairOf, PairSet } from "./pairs";
import { boxOf } from "./polygon";
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
 * components (a grid search, run only in that case). Components that even those cannot reach
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

/** About how many points share a cell of the grid `nearestAcross` searches. */
const POINTS_PER_CELL = 4;

/** A candidate neighbour: its index and squared distance. */
interface Near {
  j: number;
  d: number;
}

/** Adds `j` to `near`, kept as the `FALLBACK_NEIGHBOURS` nearest, ties to the lower index. */
function offer(near: Near[], j: number, d: number): void {
  const after = (n: Near) => n.d > d || (n.d === d && n.j > j);
  if (near.length === FALLBACK_NEIGHBOURS) {
    if (!after(near[near.length - 1])) return;
    near.pop();
  }
  let at = near.length;
  while (at > 0 && after(near[at - 1])) at--;
  near.splice(at, 0, { j, d });
}

/**
 * Each point's nearest points in other components, as deduplicated index pairs. Each point reads
 * a grid's cells in rings outward, until no cell left can hold a nearer point.
 */
function nearestAcross(points: readonly MeshPoint[], uf: UnionFind): Array<[number, number]> {
  const box = boxOf(points);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const n = points.length;
  const cell = Math.max(Math.sqrt((POINTS_PER_CELL * w * h) / n), Math.max(w, h) / n) || 1;
  const columns = Math.floor(w / cell) + 1;
  const rows = Math.floor(h / cell) + 1;
  const column = (p: Pt) => Math.min(columns - 1, Math.floor((p.x - box.x0) / cell));
  const row = (p: Pt) => Math.min(rows - 1, Math.floor((p.y - box.y0) / cell));
  const cells = Array.from({ length: columns * rows }, (): number[] => []);
  points.forEach((p, i) => cells[column(p) * rows + row(p)].push(i));
  const roots = points.map((_, i) => uf.find(i));

  const pairs = new PairSet();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const near: Near[] = [];
    const read = (x: number, y: number) => {
      for (const j of cells[x * rows + y]) {
        if (roots[j] !== roots[i]) offer(near, j, dist2(p, points[j]));
      }
    };
    const c = column(p);
    const r = row(p);
    const last = Math.max(c, columns - 1 - c, r, rows - 1 - r);
    for (let k = 0; k <= last; k++) {
      const [x0, x1] = [Math.max(0, c - k), Math.min(columns - 1, c + k)];
      const [y0, y1] = [Math.max(0, r - k + 1), Math.min(rows - 1, r + k - 1)];
      for (let x = x0; x <= x1; x++) {
        if (r - k >= 0) read(x, r - k);
        if (k > 0 && r + k < rows) read(x, r + k);
      }
      for (let y = y0; y <= y1; y++) {
        if (c - k >= 0) read(c - k, y);
        if (c + k < columns) read(c + k, y);
      }
      // A cell outside ring k lies at least k cells off; half a cell is kept for rounding.
      const clear = Math.max(0, k - 0.5) * cell;
      if (near.length === FALLBACK_NEIGHBOURS && near[near.length - 1].d < clear * clear) break;
    }
    for (const { j } of near) pairs.add(i, j);
  }
  return [...pairs.values()];
}
