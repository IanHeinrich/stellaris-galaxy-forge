import { grouped, ringArea, type Region } from "./polygon";
import type { Pt } from "./pt";

/** Rings smaller than this, in world units², are slivers and are dropped. */
const MIN_RING_AREA = 25;
/** An outline point this close to the line through the points kept either side of it is dropped. */
const SIMPLIFY_TOLERANCE = 0.05;
/** Crossings of every this many texel rows and columns are always kept, so neighbours simplify a shared border alike. */
const ANCHOR_SPACING = 16;

const TEXEL_OFFSET = 2 ** 20;
const TEXEL_SPAN = 2 ** 21;

/**
 * A cell's corners are v0 top left, v1 top right, v2 bottom right, v3 bottom left; its edges
 * 0 top, 1 right, 2 bottom, 3 left. Each case lists its segments as from and to edges, with
 * the owner's side always on the same hand, so segments chain into rings.
 */
export const CASES: readonly (readonly number[])[] = [
  [],
  [3, 0],
  [0, 1],
  [3, 1],
  [1, 2],
  [],
  [0, 2],
  [3, 2],
  [2, 3],
  [2, 0],
  [],
  [2, 1],
  [1, 3],
  [1, 0],
  [0, 3],
  [],
];
/** Cases 5 and 10, with the two inside corners joined through the cell or kept apart. */
export const SADDLES: readonly (readonly number[])[] = [
  [3, 2, 1, 0],
  [3, 0, 1, 2],
  [0, 3, 2, 1],
  [0, 1, 2, 3],
];

/** A cell edge's id, the same from either cell that shares it: the texel it starts at and its axis. */
export function edgeId(edge: number, gi: number, gj: number): number {
  const x = edge === 1 ? gi + 1 : gi;
  const y = edge === 2 ? gj + 1 : gj;
  const axis = edge === 1 || edge === 3 ? 1 : 0;
  return ((y + TEXEL_OFFSET) * TEXEL_SPAN + x + TEXEL_OFFSET) * 2 + axis;
}

/**
 * The rings the segments chain into, as polygons with holes. Each part lists its segments as
 * from edge, to edge, from x, from y.
 */
export function stitched(parts: readonly number[][]): Region {
  let count = 0;
  for (const part of parts) count += part.length / 4;
  const from = new Float64Array(count);
  const to = new Float64Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const at = new Map<number, number>();
  let n = 0;
  for (const part of parts) {
    for (let k = 0; k < part.length; k += 4, n++) {
      from[n] = part[k];
      to[n] = part[k + 1];
      xs[n] = part[k + 2];
      ys[n] = part[k + 3];
      at.set(part[k], n);
    }
  }
  const visited = new Uint8Array(count);
  const traced: { ring: Pt[]; first: number }[] = [];
  for (let start = 0; start < count; start++) {
    if (visited[start]) continue;
    const rx: number[] = [];
    const ry: number[] = [];
    const ids: number[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !visited[k]) {
      visited[k] = 1;
      rx.push(xs[k]);
      ry.push(ys[k]);
      ids.push(from[k]);
      k = at.get(to[k]);
    }
    if (k !== start) continue;
    // Every ring starts at its lowest edge, so an edit and a rebuild give the same rings.
    let low = 0;
    for (let i = 1; i < ids.length; i++) if (ids[i] < ids[low]) low = i;
    const ring = simplified(rotated(rx, low), rotated(ry, low), rotated(ids, low));
    if (ring.length >= 3 && Math.abs(ringArea(ring)) >= MIN_RING_AREA) {
      traced.push({ ring, first: ids[low] });
    }
  }
  traced.sort((a, b) => a.first - b.first);
  return nested(traced.map((t) => t.ring));
}

function isAnchor(id: number): boolean {
  const axis = id % 2;
  const texel = (id - axis) / 2;
  const line = axis === 0 ? Math.floor(texel / TEXEL_SPAN) : texel % TEXEL_SPAN;
  return line % ANCHOR_SPACING === 0;
}

function rotated(values: number[], start: number): number[] {
  return start === 0 ? values : [...values.slice(start), ...values.slice(0, start)];
}

/**
 * The ring with the points between anchors thinned by Douglas–Peucker. A stretch is always
 * thinned from its anchor with the lower id, so two owners sharing it keep the same points.
 */
function simplified(xs: number[], ys: number[], ids: number[]): Pt[] {
  const n = xs.length;
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (isAnchor(ids[i])) anchors.push(i);
  if (anchors.length < 2) return xs.map((x, i) => ({ x, y: ys[i] }));
  const keep = new Uint8Array(n);
  for (const a of anchors) keep[a] = 1;
  const chain: number[] = [];
  for (let k = 0; k < anchors.length; k++) {
    const from = anchors[k];
    const to = anchors[(k + 1) % anchors.length];
    chain.length = 0;
    for (let i = from; ; i = (i + 1) % n) {
      chain.push(i);
      if (i === to) break;
    }
    if (ids[to] < ids[from]) chain.reverse();
    thin(chain, xs, ys, keep);
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: xs[i], y: ys[i] });
  return out;
}

function thin(chain: number[], xs: number[], ys: number[], keep: Uint8Array): void {
  const stack = [0, chain.length - 1];
  const tolerance2 = SIMPLIFY_TOLERANCE * SIMPLIFY_TOLERANCE;
  while (stack.length > 0) {
    const hi = stack.pop() as number;
    const lo = stack.pop() as number;
    if (hi - lo < 2) continue;
    const ax = xs[chain[lo]];
    const ay = ys[chain[lo]];
    const dx = xs[chain[hi]] - ax;
    const dy = ys[chain[hi]] - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farthest = -1;
    for (let m = lo + 1; m < hi; m++) {
      const px = xs[chain[m]] - ax;
      const py = ys[chain[m]] - ay;
      const cross = px * dy - py * dx;
      const d = len2 > 0 ? (cross * cross) / len2 : px * px + py * py;
      if (d > farthest) {
        farthest = d;
        far = m;
      }
    }
    if (farthest <= tolerance2) continue;
    keep[chain[far]] = 1;
    stack.push(lo, far, far, hi);
  }
}

/**
 * Rings sorted into polygons: the rings traced with the territory on one hand are outer
 * rings, the others holes, each in the smallest outer ring that holds it. Outer rings come out
 * anticlockwise and holes clockwise, as the map expects.
 */
function nested(rings: Pt[][]): Region {
  for (const ring of rings) ring.reverse();
  return grouped(rings);
}
