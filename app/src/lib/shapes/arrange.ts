import type { SystemNode } from "../../generated/SystemNode";
import type { MeshPoint } from "../geometry/mesh";
import { comparePairs, PairMap, PairSet, pairOf, type Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { SEGMENT_CELL, SegmentIndex, type Segment } from "../geometry/segments";
import { copies, type Symmetry } from "../geometry/symmetry";
import type { MapExtent } from "../guides";
import { PlacementGround } from "../placement/ground";
import { laneIndex, provisionalId, provisionalIndex } from "../placement/lanes";
import { ON_TOP, SAMPLE_CAP } from "../placement/limits";
import { PointGrid } from "../placement/pointGrid";
import { SpatialGrid } from "../spatialGrid";
import { FollowGround, laidCount, leastSpacing, shapePlacement } from "./placement";
import type { PlacementRules } from "./rules";
import {
  ARRANGE_NEEDS_TWO,
  ARRANGE_SYMMETRY,
  arrangeOverCap,
  arrangeShortfall,
  arrangeTooSmall,
} from "./shapeCopy";
import { centreOf, specOf } from "./specs";
import type {
  Arrangement,
  Fill,
  PendingShape,
  ShapeLanes,
  ShapePreview,
  SpacedFill,
} from "./types";

/** The most systems one Arrange moves, as many as one shape places. */
export const ARRANGE_CAP = SAMPLE_CAP;

/** The closest a fill is searched down to when it spreads the selection, in world units. */
const CLOSEST_FILL = 1;

/** How near, as a share, the search for a fill's spacing comes to the widest that lays the count. */
const SPACING_PRECISION = 0.005;

/** How near a lane comes to a system, or to lying along another lane, to count as running into it. */
const LANE_TOUCH = 0.5;

/** Steps of distance per world unit the nearest-pair order tells apart. */
const DISTANCE_STEPS = 1024;

const SYMMETRY_OFF: Symmetry = { kind: "off" };

/** Lanes off: what Keep and Clear lay. */
const NO_LANES: ShapeLanes = { follow: false, mode: "off" };

/** A pending shape that arranges systems. */
export type ArrangingShape = PendingShape & { purpose: { kind: "arrange" } };

/** The galaxy a selection is arranged in, read once per preview. */
export interface ArrangeGround {
  /** Every system, the selection's among them. */
  systems: ReadonlyMap<number, SystemNode>;
  extent: MapExtent;
  /** The least gap and edge of the path the document takes systems by; the cap is the count. */
  rules: PlacementRules;
  symmetry: Symmetry;
  laneDensity: number;
}

/**
 * Why `count` selected systems can't be arranged under `symmetry`, whatever the shape; null
 * when they can. Under symmetry the shape's images would need systems the selection doesn't
 * hold, so Arrange works with it off.
 */
export function arrangeRefusal(count: number, symmetry: Symmetry): string | null {
  if (copies(symmetry) > 1) return ARRANGE_SYMMETRY;
  if (count < 2) return ARRANGE_NEEDS_TWO;
  return count > ARRANGE_CAP ? arrangeOverCap(ARRANGE_CAP) : null;
}

/**
 * The widest spacing at which `pending`'s fill lays at least `n` points, to within
 * `SPACING_PRECISION`; null when even the closest lays fewer. A fill is laid nearest the centre
 * first and the first `n` are kept, so the widest spacing that still lays `n` spreads them over
 * the whole shape. The search starts from the spacing the shape's area and edge give for `n`.
 */
export function arrangeSpacing(
  pending: PendingShape & { fill: SpacedFill },
  rules: PlacementRules,
  n: number,
): number | null {
  const capped = { ...rules, cap: n };
  const enough = (spacing: number) => laidCount(pending, SYMMETRY_OFF, capped, spacing) >= n;
  const closest = Math.max(CLOSEST_FILL, rules.minGap);
  const guess = Math.max(closest, leastSpacing(pending.shape, pending.fill, SYMMETRY_OFF, capped));
  let lo = guess;
  let hi = guess;
  // Past twice its size a fill lays only its edge's fewest points, which may already be enough.
  const widest = Math.max(2 * closest, 2 * specOf(pending.shape).size(pending.shape));
  if (enough(guess)) {
    do {
      lo = hi;
      hi *= 2;
      if (hi >= widest) return enough(widest) ? widest : bisect(lo, widest);
    } while (enough(hi));
  } else {
    do {
      hi = lo;
      if (lo <= closest) return null;
      lo = Math.max(closest, lo / 2);
    } while (!enough(lo));
  }
  return bisect(lo, hi);

  /** The widest spacing between `from`, which lays enough, and `to`, which doesn't. */
  function bisect(from: number, to: number): number {
    let [enoughAt, shortAt] = [from, to];
    while (shortAt / enoughAt > 1 + SPACING_PRECISION) {
      const mid = Math.sqrt(enoughAt * shortAt);
      if (enough(mid)) enoughAt = mid;
      else shortAt = mid;
    }
    return enoughAt;
  }
}

/** The last spacing searched for, and what it was searched for. */
let spacingCache: { key: string; spacing: number | null } | null = null;

/**
 * `arrangeSpacing`, kept while only the shape's place changes: a fill is laid in the shape's own
 * frame, so moving the shape lays the same pattern and a drag searches once.
 */
function spacingFor(
  pending: PendingShape & { fill: SpacedFill },
  rules: PlacementRules,
  n: number,
): number | null {
  const { shape, fill, seed } = pending;
  const placeless = shape.kind === "line" ? shape : { ...shape, centre: { x: 0, y: 0 } };
  const key = JSON.stringify([placeless, fill, seed, n, rules.minGap]);
  if (spacingCache?.key !== key) {
    spacingCache = { key, spacing: arrangeSpacing(pending, rules, n) };
  }
  return spacingCache.spacing;
}

/** How many of its nearest free points each system keeps to hand while the pairs are taken. */
const CANDIDATES = 24;

/**
 * For each of `from`, the index of the point of `to` it takes: the nearest pair of all goes
 * first, then the nearest of what is left, until every one of `from` has a point. Pairs are
 * ordered by their distance to a thousandth of a unit, then by the point's place and the
 * system's.
 *
 * Rather than sort every pair, each system keeps its `CANDIDATES` nearest points, and a heap
 * holds each system's nearest that is still free. A system whose kept points are all taken
 * finds its nearest free ones again, so the pairs come off in the same order a full sort gives.
 */
export function nearestFree(from: readonly Pt[], to: readonly Pt[]): number[] {
  const m = to.length;
  const taken = new Uint8Array(m);
  const pointOf = new Array<number>(from.length).fill(-1);
  /** Each pair's key: its distance in steps, then its point, packed so plain numbers order them. */
  const keyOf = (i: number, j: number) =>
    Math.round(Math.hypot(from[i].x - to[j].x, from[i].y - to[j].y) * DISTANCE_STEPS) * m + j;
  const kept: Float64Array[] = [];
  const next = new Int32Array(from.length);
  /** The nearest free points of system `i`, as sorted keys. */
  const refill = (i: number) => {
    const best = new Float64Array(CANDIDATES);
    let count = 0;
    for (let j = 0; j < m; j++) {
      if (taken[j] === 1) continue;
      const key = keyOf(i, j);
      if (count === CANDIDATES && key >= best[count - 1]) continue;
      let at = count < CANDIDATES ? count++ : count - 1;
      while (at > 0 && best[at - 1] > key) {
        best[at] = best[at - 1];
        at--;
      }
      best[at] = key;
    }
    kept[i] = best.subarray(0, count);
    next[i] = 0;
  };
  /** System `i`'s nearest free pair's key, finding its points again once those kept are taken; null with none free. */
  const nearest = (i: number): number | null => {
    for (;;) {
      const list = kept[i];
      while (next[i] < list.length && taken[list[next[i]] % m] === 1) next[i]++;
      if (next[i] < list.length) return list[next[i]];
      if (list.length < CANDIDATES) return null;
      refill(i);
    }
  };
  const heap = new MinHeap();
  for (let i = 0; i < from.length; i++) {
    refill(i);
    const key = nearest(i);
    if (key !== null) heap.push(key, i);
  }
  for (let top = heap.pop(); top !== null; top = heap.pop()) {
    const [key, i] = top;
    const j = key % m;
    if (taken[j] === 1) {
      const again = nearest(i);
      if (again !== null) heap.push(again, i);
      continue;
    }
    pointOf[i] = j;
    taken[j] = 1;
  }
  return pointOf;
}

/** A binary heap of (key, system) entries, smallest key first and then smallest system. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly ids: number[] = [];

  push(key: number, id: number): void {
    const { keys, ids } = this;
    let at = keys.length;
    keys.push(key);
    ids.push(id);
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (!this.before(at, up)) break;
      this.swap(at, up);
      at = up;
    }
  }

  pop(): [number, number] | null {
    const { keys, ids } = this;
    if (keys.length === 0) return null;
    const top: [number, number] = [keys[0], ids[0]];
    const lastKey = keys.pop()!;
    const lastId = ids.pop()!;
    if (keys.length > 0) {
      keys[0] = lastKey;
      ids[0] = lastId;
      let at = 0;
      for (;;) {
        const l = 2 * at + 1;
        const r = l + 1;
        let low = at;
        if (l < keys.length && this.before(l, low)) low = l;
        if (r < keys.length && this.before(r, low)) low = r;
        if (low === at) break;
        this.swap(at, low);
        at = low;
      }
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    const { keys, ids } = this;
    return keys[a] < keys[b] || (keys[a] === keys[b] && ids[a] < ids[b]);
  }

  private swap(a: number, b: number): void {
    const { keys, ids } = this;
    [keys[a], keys[b]] = [keys[b], keys[a]];
    [ids[a], ids[b]] = [ids[b], ids[a]];
  }
}

/** Where `points` stand on average, and how far the farthest is from there; the origin for none. */
export function spreadOf(points: readonly Pt[]): { mid: Pt; spread: number } {
  const n = points.length;
  if (n === 0) return { mid: { x: 0, y: 0 }, spread: 0 };
  const mid = {
    x: points.reduce((t, p) => t + p.x, 0) / n,
    y: points.reduce((t, p) => t + p.y, 0) / n,
  };
  return { mid, spread: Math.max(...points.map((p) => Math.hypot(p.x - mid.x, p.y - mid.y))) };
}

/**
 * `points` moved and scaled about where they stand on average onto `pending`'s shape, as far
 * out as its size at the farthest, so each goes to the point on the shape's side it was on.
 */
function onto(points: readonly Pt[], pending: PendingShape): Pt[] {
  const { mid, spread } = spreadOf(points);
  const spec = specOf(pending.shape);
  const scale = spread > 0 ? spec.size(pending.shape) / spread : 1;
  const c = centreOf(pending.shape);
  return points.map((p) => ({ x: c.x + (p.x - mid.x) * scale, y: c.y + (p.y - mid.y) * scale }));
}

/** The galaxy without the selection, which the shape is laid into, and what is read of it. */
interface Others {
  systems: ReadonlyMap<number, SystemNode>;
  ground: PlacementGround;
  /** Their lanes, which a kept lane must not run into. */
  lanes: SegmentIndex<MeshPoint>;
}

/** The last `Others` built, kept while the galaxy and the selection are the same. */
let othersCache: { systems: ReadonlyMap<number, SystemNode>; key: string; others: Others } | null =
  null;

/** The galaxy without `selected`, built again only when the systems or the selection change. */
function othersOf(systems: ReadonlyMap<number, SystemNode>, selected: ReadonlySet<number>): Others {
  const key = [...selected].sort((a, b) => a - b).join(",");
  if (othersCache?.systems === systems && othersCache.key === key) return othersCache.others;
  const kept = new Map([...systems].filter(([id]) => !selected.has(id)));
  const grid = new SpatialGrid();
  grid.build(kept.values());
  const others = {
    systems: kept,
    ground: new PlacementGround(kept, grid, SYMMETRY_OFF),
    lanes: laneIndex(kept),
  };
  othersCache = { systems, key, others };
  return others;
}

/** The lanes with at least one end among `ids`: those between two of them, and those out to other systems. */
function lanesOf(
  systems: ReadonlyMap<number, SystemNode>,
  ids: ReadonlySet<number>,
): { inner: Pair[]; outer: Pair[] } {
  const inner = new PairSet();
  const outer = new PairSet();
  for (const id of ids) {
    for (const lane of systems.get(id)?.lanes ?? []) {
      if (!systems.has(lane.to)) continue;
      (ids.has(lane.to) ? inner : outer).add(id, lane.to);
    }
  }
  return { inner: inner.sorted(), outer: outer.sorted() };
}

/** Whether `a` and `b` are kept apart from a lane. */
function prevented(systems: ReadonlyMap<number, SystemNode>, a: number, b: number): boolean {
  return (
    systems.get(a)?.prevented.includes(b) === true || systems.get(b)?.prevented.includes(a) === true
  );
}

/** How far `p` is from the segment `a`–`b`. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2 : 0;
  const s = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + s * dx), p.y - (a.y + s * dy));
}

/** Whether `p` lies on the segment `a`–`b` short of its ends, within `LANE_TOUCH`. */
function onInside(p: Pt, a: Pt, b: Pt): boolean {
  const away = (q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) > LANE_TOUCH;
  return away(a) && away(b) && toSegment(p, a, b) <= LANE_TOUCH;
}

/**
 * Whether `a`–`b` and `c`–`d` lie along each other for some length, within `LANE_TOUCH`: both
 * on one line, and one's end inside the other or the two the same.
 */
function overlapping(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const near = (p: Pt, q: Pt, r: Pt) => toSegment(p, q, r) <= LANE_TOUCH;
  if (!(near(c, a, b) || near(a, c, d)) || !(near(d, a, b) || near(b, c, d))) return false;
  return (
    onInside(c, a, b) ||
    onInside(d, a, b) ||
    onInside(a, c, d) ||
    onInside(b, c, d) ||
    (near(a, c, d) && near(b, c, d) && near(c, a, b) && near(d, a, b))
  );
}

/** Points every `SEGMENT_CELL` along `a`–`b`, both ends included. */
function along(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SEGMENT_CELL));
  return Array.from({ length: n + 1 }, (_, k) => ({
    x: a.x + ((b.x - a.x) * k) / n,
    y: a.y + ((b.y - a.y) * k) / n,
  }));
}

/** Where the systems and lanes stand once arranged, which a kept lane is checked against. */
interface After {
  others: Others;
  /** The arranged systems at their points. */
  moved: PointGrid;
  /** The lanes the arranged systems end up with. */
  lanes: SegmentIndex;
}

/**
 * Whether the lane `a`–`b` runs into something once the systems move: crosses another lane, lies
 * along one, or passes through a system that isn't one of its ends.
 */
function runsInto(a: Pt, b: Pt, after: After): boolean {
  const { others, moved, lanes } = after;
  if (others.lanes.crosses(a, b) || lanes.crosses(a, b)) return true;
  const samples = along(a, b);
  const reach = SEGMENT_CELL / 2 + LANE_TOUCH;
  const lying = (s: Segment) => (s.a !== a || s.b !== b) && overlapping(a, b, s.a, s.b);
  if (others.lanes.near(samples, reach).some(lying)) return true;
  if (lanes.near(samples, reach).some(lying)) return true;
  const x0 = Math.min(a.x, b.x) - LANE_TOUCH;
  const y0 = Math.min(a.y, b.y) - LANE_TOUCH;
  const x1 = Math.max(a.x, b.x) + LANE_TOUCH;
  const y1 = Math.max(a.y, b.y) + LANE_TOUCH;
  if (moved.someInBox(x0, y0, x1, y1, (p) => onInside(p, a, b))) return true;
  let through = false;
  others.ground.grid.forEachIn(x0, y0, x1, y1, (s) => {
    through ||= onInside(s, a, b);
  });
  return through;
}

/** What arranging `count` systems does when it is refused for `refusal`: nothing. */
function refusedArrangement(refusal: string, count: number): Arrangement {
  return { count, moves: [], cut: [], added: [], crossing: [], refusal };
}

/** A preview with no points, refused for `refusal`. */
function refused(refusal: string, count: number): ShapePreview {
  return {
    points: [],
    pairs: [],
    left: [],
    outside: [],
    overlaps: 0,
    crowded: 0,
    capped: false,
    interleaved: null,
    classes: null,
    arranged: refusedArrangement(refusal, count),
  };
}

/** The fill that lays `n` points: an outline of `n`, or a fill as it is, spread by `arrangeSpacing`. */
function fillFor(fill: Fill, n: number): Fill {
  return fill.kind === "outline" ? { kind: "outline", count: n } : fill;
}

function pairSet(pairs: Iterable<Pair>): PairSet {
  const set = new PairSet();
  for (const [a, b] of pairs) set.add(a, b);
  return set;
}

/**
 * Where arranging `pending`'s selection onto it would move each system, and what it does with
 * their lanes. The points are laid as for adding as many systems as are selected, into the
 * galaxy without them: an outline takes that count, and a fill the widest spacing that lays it.
 * Each system goes to the nearest free point, measured with the selection laid over the shape
 * (centre on centre, its spread on the shape's size), so the order round a ring follows where
 * they were wherever the shape is.
 *
 * Refused under symmetry, where the shape's images have no systems to move, and when fewer
 * points fit than systems: for points past the edge, too close to each other, or too close to a
 * system left where it is, which is within `ON_TOP` in any document and the rules' gap where
 * that is wider, so no system lands on another.
 *
 * Keep leaves every lane, and names those that would cross, lie along another lane or pass
 * through a system once moved. Clear takes out the lanes between selected systems, and Rebuild
 * takes them out and lays new ones as a shape adding systems would, never one the galaxy keeps
 * apart or keeps already. With `alsoOuter` both take out the lanes to other systems too;
 * otherwise those stay and stretch to follow. A lane Rebuild would lay again stays as it is.
 */
export function arrangement(pending: ArrangingShape, ground: ArrangeGround): ShapePreview {
  const { systems, rules } = ground;
  const { purpose } = pending;
  const ids = [...new Set(purpose.ids)].filter((id) => systems.has(id));
  const n = ids.length;
  const refusal = arrangeRefusal(n, ground.symmetry);
  if (refusal !== null) return refused(refusal, n);

  const selected = new Set(ids);
  const others = othersOf(systems, selected);
  const laid: PendingShape = {
    ...pending,
    fill: fillFor(pending.fill, n),
    lanes: NO_LANES,
    skipNear: false,
  };
  const { fill } = laid;
  const spacing = fill.kind === "outline" ? undefined : spacingFor({ ...laid, fill }, rules, n);
  if (spacing === null) return refused(arrangeTooSmall(n), n);
  const shapeGround = {
    placement: others.ground,
    extent: ground.extent,
    rules: { ...rules, cap: n },
    starWeights: null,
    laneDensity: ground.laneDensity,
  };
  const options = { spacing, clear: Math.max(ON_TOP, rules.minGap) };
  const placed = shapePlacement(laid, shapeGround, options);
  const { points } = placed;
  if (points.length < n) {
    return {
      ...placed,
      arranged: refusedArrangement(arrangeShortfall(n, points.length, placed), n),
    };
  }

  const at = (id: number): Pt => systems.get(id)!;
  const pointOf = nearestFree(onto(ids.map(at), pending), points);
  const systemAt = new Array<number>(n);
  pointOf.forEach((j, i) => (systemAt[j] = ids[i]));
  const moves = points.map((p, j) => ({ system: systemAt[j], x: p.x, y: p.y }));
  const pointOfId = new Map(ids.map((id, i) => [id, pointOf[i]]));
  const shownId = (id: number) => {
    const j = pointOfId.get(id);
    return j === undefined ? id : provisionalId(j);
  };
  const realId = (id: number) => (id < 0 ? systemAt[provisionalIndex(id)] : id);
  const shownAt = (id: number): Pt => (id < 0 ? points[provisionalIndex(id)] : at(id));

  const { inner, outer } = lanesOf(systems, selected);
  const keep = purpose.lanes === "keep";
  const removable = keep ? [] : purpose.alsoOuter ? [...inner, ...outer] : inner;
  const removableSet = pairSet(removable);
  const kept = [...inner, ...outer].filter(([a, b]) => !removableSet.has(a, b));
  const keptSet = pairSet(kept);
  const keptShown = kept.map(([a, b]) => pairOf(shownId(a), shownId(b)));
  const segment = ([a, b]: Pair): Segment<MeshPoint> => ({
    a: { id: a, ...shownAt(a) },
    b: { id: b, ...shownAt(b) },
  });

  let laidPairs: Pair[] = [];
  if (purpose.lanes === "rebuild") {
    const withLanes = { ...laid, lanes: pending.lanes };
    const around = {
      ...shapeGround,
      placement: new FollowGround(others.ground, keptShown.map(segment)),
    };
    laidPairs = shapePlacement(withLanes, around, options).pairs.filter(([a, b]) => {
      const [x, y] = [realId(a), realId(b)];
      return !keptSet.has(x, y) && !prevented(systems, x, y);
    });
  }
  const laidReal = pairSet(laidPairs.map(([a, b]) => pairOf(realId(a), realId(b))));
  const cut = removable.filter(([a, b]) => !laidReal.has(a, b));
  const added = laidReal.sorted().filter(([a, b]) => !removableSet.has(a, b));
  const keptAgain = removable.filter(([a, b]) => laidReal.has(a, b));

  const shown = pairSet(laidPairs);
  for (const [a, b] of [...kept, ...keptAgain]) shown.add(shownId(a), shownId(b));
  const segments = new PairMap<Segment<MeshPoint>>();
  const lanes = new SegmentIndex();
  for (const pair of shown.values()) {
    const s = segment(pair);
    segments.set(...pair, s);
    lanes.add(s.a, s.b);
  }
  const moved = new PointGrid(SEGMENT_CELL);
  for (const p of points) moved.add(p);
  const after = { others, moved, lanes };
  const crossing = keptShown.filter(([a, b]) => {
    const s = segments.get(a, b)!;
    return runsInto(s.a, s.b, after);
  });

  return {
    ...placed,
    pairs: shown.sorted(),
    arranged: { count: n, moves, cut, added, crossing: crossing.sort(comparePairs), refusal: null },
  };
}
