import { seeded, type Rand } from "../random";
import { DEFAULT_LANE_DENSITY, delaunayPairs, type MeshPoint } from "./mesh";
import { comparePairs, pairOf, type Pair } from "./pairs";
import { dist2 } from "./pt";
import { UnionFind } from "./unionFind";

/** Most islands hold 4 to 10 systems, and one in five 8 to 15, as the game's setup partitions them. */
const SMALL_ISLAND = { min: 4, max: 10 } as const;
const LARGE_ISLAND = { min: 8, max: 15 } as const;
const LARGE_SHARE = 0.2;
/** An island smaller than this joins its nearest neighbouring island that stays within 15. */
const LEAST_ISLAND = 4;
const FOLD_PASSES = 3;
/** The share of an island's Delaunay edges taken out at the default Lane density, as in the game's saves. */
const DROP_AT_DEFAULT = 0.24;
/** Thinning never leaves a system with fewer lanes inside its island than this. */
const LEAST_LANES = 2;
/** The joins between islands, per island: a spanning tree over them, then more at random. */
const JOINS_PER_ISLAND = 1.26;

/** The lanes `islandLanes` lays, and the ids of each island's systems. */
export interface IslandLanes {
  pairs: Pair[];
  islands: number[][];
}

/** Which edges the rule may lay, by their ends; every Delaunay edge when left out. */
export type UsableEdge = (p: MeshPoint, q: MeshPoint) => boolean;

/**
 * The lanes over `points` grouped into islands as the game's hyperlane generation groups them,
 * as [id, id] pairs with a < b. Islands of 4 to 10 systems (one in five of 8 to 15) grow over
 * Delaunay neighbours, and one smaller than 4 joins its nearest neighbour, one it keeps within 15
 * where it can. Inside each island
 * the longest Delaunay edges go first, down to the share `density` keeps, never leaving a system
 * under 2 lanes there or splitting the island. Islands join by their single shortest edge
 * between them: a spanning tree over the islands, then more at random up to 1.26 per island.
 * Only Delaunay edges `usable` allows are laid, so no two lanes cross; `seed` fixes the draw.
 */
export function islandLanes(
  points: readonly MeshPoint[],
  density: number,
  seed: number,
  usable?: UsableEdge,
): IslandLanes {
  if (points.length < 2) return { pairs: [], islands: points.map((p) => [p.id]) };
  const indexOf = new Map(points.map((p, i) => [p.id, i]));
  const length = ([i, j]: readonly [number, number]) => dist2(points[i], points[j]);
  const edges = delaunayPairs(points)
    .map(([a, b]): [number, number] => [indexOf.get(a)!, indexOf.get(b)!])
    .filter(([i, j]) => !usable || usable(points[i], points[j]));
  const rand = seeded(seed);
  const island = islandsOf(points, edges, rand);

  const inside = new Map<number, Array<[number, number]>>();
  const between = new Map<string, [number, number]>();
  for (const edge of edges) {
    const [i, j] = edge;
    const [s, t] = [island[i], island[j]];
    if (s === t) {
      const list = inside.get(s) ?? [];
      list.push(edge);
      inside.set(s, list);
      continue;
    }
    const key = s < t ? `${s},${t}` : `${t},${s}`;
    const best = between.get(key);
    if (!best || length(edge) < length(best)) between.set(key, edge);
  }

  const drop = dropShare(density);
  const laid: Array<[number, number]> = [];
  for (const list of inside.values()) laid.push(...thinned(list, drop, length));
  laid.push(...joins([...between.values()], island, new Set(island).size, length, rand));
  const members = new Map<number, number[]>();
  island.forEach((s, i) => {
    const list = members.get(s) ?? [];
    list.push(points[i].id);
    members.set(s, list);
  });
  return {
    pairs: laid.map(([i, j]) => pairOf(points[i].id, points[j].id)).sort(comparePairs),
    islands: [...members.values()],
  };
}

/**
 * The share of each island's edges taken out at `density`: all it can at 0, the game's 24% at
 * the default, and none at 1, straight between.
 */
function dropShare(density: number): number {
  if (density <= DEFAULT_LANE_DENSITY) {
    return 1 - ((1 - DROP_AT_DEFAULT) * Math.max(0, density)) / DEFAULT_LANE_DENSITY;
  }
  return (DROP_AT_DEFAULT * (1 - Math.min(1, density))) / (1 - DEFAULT_LANE_DENSITY);
}

function sizeIn(rand: Rand, { min, max }: { min: number; max: number }): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** The island each point falls in, numbered from 0. */
function islandsOf(
  points: readonly MeshPoint[],
  edges: ReadonlyArray<readonly [number, number]>,
  rand: Rand,
): number[] {
  const n = points.length;
  const near: number[][] = points.map(() => []);
  for (const [i, j] of edges) {
    near[i].push(j);
    near[j].push(i);
  }
  near.forEach((list, i) => {
    const d = (j: number) => dist2(points[i], points[j]);
    list.sort((j, k) => d(j) - d(k) || j - k);
  });

  const order = points.map((_, i) => i);
  for (let k = n - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    [order[k], order[r]] = [order[r], order[k]];
  }
  const island = new Array<number>(n).fill(-1);
  const members: number[][] = [];
  for (const start of order) {
    if (island[start] !== -1) continue;
    const size = sizeIn(rand, rand() < LARGE_SHARE ? LARGE_ISLAND : SMALL_ISLAND);
    const at = members.length;
    const grown = [start];
    island[start] = at;
    for (let head = 0; head < grown.length && grown.length < size; head++) {
      for (const v of near[grown[head]]) {
        if (grown.length >= size) break;
        if (island[v] !== -1) continue;
        island[v] = at;
        grown.push(v);
      }
    }
    members.push(grown);
  }

  for (let pass = 0; pass < FOLD_PASSES; pass++) {
    const size = (i: number) => members[island[i]].length;
    const bySize = order.slice().sort((u, v) => size(u) - size(v) || u - v);
    for (const u of bySize) {
      const own = island[u];
      if (members[own].length >= LEAST_ISLAND) continue;
      const others = near[u].filter((v) => island[v] !== own);
      const fits = (v: number) =>
        members[island[v]].length + members[own].length <= LARGE_ISLAND.max;
      const other = others.find(fits) ?? others[0];
      if (other === undefined) continue;
      const into = island[other];
      for (const w of members[own]) island[w] = into;
      members[into].push(...members[own]);
      members[own] = [];
    }
  }
  return island;
}

/**
 * `edges`, one island's, with the longest taken out first until `drop` of them are gone, each
 * only while both its ends keep `LEAST_LANES` and its ends stay joined without it.
 */
function thinned(
  edges: Array<[number, number]>,
  drop: number,
  length: (edge: readonly [number, number]) => number,
): Array<[number, number]> {
  const target = Math.round(drop * edges.length);
  const degree = new Map<number, number>();
  const near = new Map<number, Set<number>>();
  for (const [i, j] of edges) {
    for (const [a, b] of [
      [i, j],
      [j, i],
    ]) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      const set = near.get(a) ?? new Set<number>();
      set.add(b);
      near.set(a, set);
    }
  }
  const longestFirst = edges
    .slice()
    .sort((e, f) => length(f) - length(e) || e[0] - f[0] || e[1] - f[1]);
  const gone = new Set<[number, number]>();
  for (const edge of longestFirst) {
    if (gone.size >= target) break;
    const [i, j] = edge;
    if (degree.get(i)! <= LEAST_LANES || degree.get(j)! <= LEAST_LANES) continue;
    near.get(i)!.delete(j);
    near.get(j)!.delete(i);
    if (!reaches(near, i, j)) {
      near.get(i)!.add(j);
      near.get(j)!.add(i);
      continue;
    }
    degree.set(i, degree.get(i)! - 1);
    degree.set(j, degree.get(j)! - 1);
    gone.add(edge);
  }
  return edges.filter((edge) => !gone.has(edge));
}

function reaches(
  near: ReadonlyMap<number, ReadonlySet<number>>,
  from: number,
  to: number,
): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const u = stack.pop()!;
    if (u === to) return true;
    for (const v of near.get(u) ?? []) {
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(v);
    }
  }
  return false;
}

/**
 * The joins between islands, from `candidates`, the shortest edge between each pair of them:
 * the shortest spanning tree over the islands, then others at random up to
 * `JOINS_PER_ISLAND` per island.
 */
function joins(
  candidates: Array<[number, number]>,
  island: readonly number[],
  islands: number,
  length: (edge: readonly [number, number]) => number,
  rand: Rand,
): Array<[number, number]> {
  candidates.sort((e, f) => length(e) - length(f) || e[0] - f[0] || e[1] - f[1]);
  const sets = new UnionFind(island.length);
  const tree: Array<[number, number]> = [];
  const more: Array<[number, number]> = [];
  for (const edge of candidates) {
    const [i, j] = edge;
    (sets.union(island[i], island[j]) ? tree : more).push(edge);
  }
  for (let k = more.length - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    [more[k], more[r]] = [more[r], more[k]];
  }
  const extra = Math.max(0, Math.round(JOINS_PER_ISLAND * islands) - tree.length);
  return [...tree, ...more.slice(0, extra)];
}
