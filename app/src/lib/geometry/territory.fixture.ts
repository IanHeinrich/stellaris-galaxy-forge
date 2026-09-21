/** The synthetic late-game galaxy the territory bench and the tiled-union test share. */
import type { SystemNode } from "../../generated/SystemNode";
import { name, systemNode } from "../../test/builders";

const GALAXY_SEED = 0xc0ffee;
const GALAXY_RADIUS = 500;
const MIN_SPACING = 25;
const LATTICE_SPACING = 26.1;
const LATTICE_JITTER = 1;
const COUNTRY_COUNT = 34;
const UNOWNED_FRACTION = 0.15;
/** Systems a country claims per growth round, from the slowest to the fastest grower. */
const GROWTH_MIN = 1;
const GROWTH_MAX = 16;

interface Point {
  x: number;
  y: number;
}

export interface Galaxy {
  systems: SystemNode[];
  laneCount: number;
  /** Every country and how many systems it holds, largest first. */
  sizes: { country: number; size: number }[];
}

/** mulberry32: a small, fast, seeded PRNG so the galaxy is the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function shuffledIndices(count: number, rand: () => number): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/**
 * Points on a jittered hex lattice inside the disc, thinned so no two survivors are closer
 * than `minSpacing`. A pure random rejection sampler jams out well short of 1000 points at
 * this spacing, so the lattice gives the scatter room to reach a late-game system count.
 */
function scatterSystems(rand: () => number, radius: number, minSpacing: number): Point[] {
  const points: Point[] = [];
  const buckets = new Map<string, Point[]>();
  const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;
  const bucketOf = (p: Point): string =>
    cellKey(Math.floor(p.x / minSpacing), Math.floor(p.y / minSpacing));
  const tooClose = (p: Point): boolean => {
    const cx = Math.floor(p.x / minSpacing);
    const cy = Math.floor(p.y / minSpacing);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        const bucket = buckets.get(cellKey(i, j));
        if (!bucket) continue;
        for (const q of bucket) if (dist2(p, q) < minSpacing * minSpacing) return true;
      }
    }
    return false;
  };
  const accept = (p: Point): void => {
    points.push(p);
    const key = bucketOf(p);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  };

  const rowHeight = (LATTICE_SPACING * Math.sqrt(3)) / 2;
  let row = 0;
  for (let y = -radius; y <= radius; y += rowHeight, row++) {
    const xOffset = row % 2 === 0 ? 0 : LATTICE_SPACING / 2;
    for (let x = -radius + xOffset; x <= radius; x += LATTICE_SPACING) {
      const p: Point = {
        x: x + (rand() * 2 - 1) * LATTICE_JITTER,
        y: y + (rand() * 2 - 1) * LATTICE_JITTER,
      };
      if (dist2(p, { x: 0, y: 0 }) > radius * radius) continue;
      if (tooClose(p)) continue;
      accept(p);
    }
  }
  return points;
}

/** The `k` nearest other points to `points[i]`, closest first. */
function nearestNeighbours(points: Point[], i: number, k: number): number[] {
  const best: { j: number; d: number }[] = [];
  for (let j = 0; j < points.length; j++) {
    if (j === i) continue;
    const d = dist2(points[i], points[j]);
    if (best.length < k) {
      best.push({ j, d });
      best.sort((a, b) => a.d - b.d);
    } else if (d < best[best.length - 1].d) {
      best[best.length - 1] = { j, d };
      best.sort((a, b) => a.d - b.d);
    }
  }
  return best.map((b) => b.j);
}

/** Each system laned to its 2-4 nearest neighbours, symmetrically. */
function buildLaneGraph(points: Point[], rand: () => number): Set<number>[] {
  const graph: Set<number>[] = points.map(() => new Set());
  for (let i = 0; i < points.length; i++) {
    const k = 2 + Math.floor(rand() * 3);
    for (const j of nearestNeighbours(points, i, k)) {
      graph[i].add(j);
      graph[j].add(i);
    }
  }
  return graph;
}

/**
 * Flood fill from `countryCount` random seed systems over the lane graph, in randomised
 * round-robin order so countries end up as contiguous blobs. Each country claims its own
 * number of systems per round, cubed-uniform between `GROWTH_MIN` and `GROWTH_MAX`, so a
 * few grow into late-game empires while most stay small. A random `unownedFraction` of all
 * systems is then cleared back to no owner.
 */
function assignCountries(
  graph: Set<number>[],
  rand: () => number,
  countryCount: number,
  unownedFraction: number,
): (number | null)[] {
  const n = graph.length;
  const owner: (number | null)[] = new Array(n).fill(null);
  const seeds = shuffledIndices(n, rand).slice(0, countryCount);
  const queues: number[][] = seeds.map((seed, country) => {
    owner[seed] = country;
    return [seed];
  });
  const growth = seeds.map(
    () => GROWTH_MIN + Math.floor(rand() ** 3 * (GROWTH_MAX - GROWTH_MIN + 1)),
  );

  let active = queues.map((_, country) => country);
  while (active.length > 0) {
    const next: number[] = [];
    for (const country of shuffledIndices(active.length, rand).map((i) => active[i])) {
      const queue = queues[country];
      for (let step = 0; step < growth[country] && queue.length > 0; step++) {
        const current = queue.shift() as number;
        for (const neighbour of graph[current]) {
          if (owner[neighbour] === null) {
            owner[neighbour] = country;
            queue.push(neighbour);
          }
        }
      }
      if (queue.length > 0) next.push(country);
    }
    active = next;
  }

  const unownedCount = Math.round(n * unownedFraction);
  for (const i of shuffledIndices(n, rand).slice(0, unownedCount)) owner[i] = null;
  return owner;
}

function buildSystems(
  points: Point[],
  graph: Set<number>[],
  owner: (number | null)[],
): SystemNode[] {
  return points.map((p, i) =>
    systemNode({
      id: i,
      name: name(`NAME_${i}`),
      x: p.x,
      y: p.y,
      owner: owner[i],
      lanes: [...graph[i]].map((to) => ({
        to,
        length: Math.floor(Math.sqrt(dist2(p, points[to]))),
        bridge: false,
        stale: false,
      })),
    }),
  );
}

/**
 * A late-game galaxy: ~1000 laned systems, ~34 contiguous countries of which the largest
 * holds ~100 systems and several 50 or more, ~15% unowned.
 */
export function buildGalaxy(): Galaxy {
  const rand = mulberry32(GALAXY_SEED);
  const points = scatterSystems(rand, GALAXY_RADIUS, MIN_SPACING);
  const graph = buildLaneGraph(points, rand);
  const owner = assignCountries(graph, rand, COUNTRY_COUNT, UNOWNED_FRACTION);
  const systems = buildSystems(points, graph, owner);

  const laneCount = graph.reduce((sum, neighbours) => sum + neighbours.size, 0) / 2;
  const countrySizes = new Map<number, number>();
  for (const o of owner) if (o !== null) countrySizes.set(o, (countrySizes.get(o) ?? 0) + 1);
  const sizes = [...countrySizes]
    .map(([country, size]) => ({ country, size }))
    .sort((a, b) => b.size - a.size || a.country - b.country);
  return { systems, laneCount, sizes };
}
