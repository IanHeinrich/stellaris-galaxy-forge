import type { SystemNode } from "../../generated/SystemNode";
import type { MeshPoint } from "../geometry/mesh";
import { comparePairs, PairSet, pairOf, type Pair } from "../geometry/pairs";
import { dist2, type Pt } from "../geometry/pt";
import { SegmentIndex, type Segment } from "../geometry/segments";
import { copies, type Symmetry } from "../geometry/symmetry";
import type { MapExtent } from "../guides";
import { PlacementGround } from "../placement/ground";
import { laneSegments, provisionalId, provisionalIndex } from "../placement/lanes";
import { SAMPLE_CAP } from "../placement/limits";
import { SpatialGrid } from "../spatialGrid";
import { FollowGround, laidCount, shapePlacement } from "./placement";
import type { PlacementRules } from "./rules";
import {
  ARRANGE_NEEDS_TWO,
  ARRANGE_SYMMETRY,
  arrangeOverCap,
  arrangeShortfall,
  arrangeTooSmall,
} from "./shapeCopy";
import { centreOf, specOf } from "./specs";
import type { Fill, PendingShape, ShapeLanes, ShapePreview } from "./types";

/** The most systems one Arrange moves, as many as one shape places. */
export const ARRANGE_CAP = SAMPLE_CAP;

/** The closest a fill is searched down to when it spreads the selection, in world units. */
const CLOSEST_FILL = 1;

/** How many halvings the search for a fill's spacing takes. */
const SPACING_STEPS = 24;

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
 * The widest spacing at which `pending`'s fill lays at least `n` points; null when even the
 * closest lays fewer. A fill is laid nearest the centre first and the first `n` are kept, so the
 * widest spacing that still lays `n` spreads them over the whole shape.
 */
export function arrangeSpacing(
  pending: PendingShape,
  rules: PlacementRules,
  n: number,
): number | null {
  const capped = { ...rules, cap: n };
  const enough = (spacing: number) => laidCount(pending, SYMMETRY_OFF, capped, spacing) >= n;
  let lo = Math.max(CLOSEST_FILL, rules.minGap);
  if (!enough(lo)) return null;
  let hi = Math.max(2 * lo, 2 * specOf(pending.shape).size(pending.shape));
  if (enough(hi)) return hi;
  for (let i = 0; i < SPACING_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (enough(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * For each of `from`, the index of the point of `to` it takes: the nearest pair of all goes
 * first, then the nearest of what is left, until every one of `from` has a point.
 */
export function nearestFree(from: readonly Pt[], to: readonly Pt[]): number[] {
  const m = to.length;
  const d = new Float64Array(from.length * m);
  from.forEach((p, i) => to.forEach((q, j) => (d[i * m + j] = dist2(p, q))));
  const order = Uint32Array.from({ length: d.length }, (_, k) => k).sort(
    (a, b) => d[a] - d[b] || a - b,
  );
  const taken = new Uint8Array(m);
  const pointOf = new Array<number>(from.length).fill(-1);
  let left = Math.min(from.length, m);
  for (const k of order) {
    if (left === 0) break;
    const i = Math.floor(k / m);
    const j = k - i * m;
    if (pointOf[i] !== -1 || taken[j] === 1) continue;
    pointOf[i] = j;
    taken[j] = 1;
    left--;
  }
  return pointOf;
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

/** What arranging `count` systems does when it is refused for `refusal`: nothing. */
function refusedArrangement(refusal: string, count: number): NonNullable<ShapePreview["arranged"]> {
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

/**
 * Where arranging `pending`'s selection onto it would move each system, and what it does with
 * their lanes. The points are laid as for adding as many systems as are selected, into the
 * galaxy without them: an outline takes that count, and a fill the widest spacing that lays it.
 * Each system goes to the nearest free point, measured with the selection laid over the shape
 * (centre on centre, its spread on the shape's size), so the order round a ring follows where
 * they were wherever the shape is.
 * Refused under symmetry, where the shape's images have no systems to move, and when fewer
 * points fit than systems, for points too close to other systems, past the edge or too close
 * to each other.
 *
 * Keep leaves every lane. Clear takes out the lanes between selected systems, and Rebuild takes
 * them out and lays new ones as a shape adding systems would, never one the galaxy keeps apart
 * or already has. Lanes out to other systems stay in every case and stretch to follow.
 */
export function arrangement(pending: ArrangingShape, ground: ArrangeGround): ShapePreview {
  const { systems, rules } = ground;
  const ids = [...new Set(pending.purpose.ids)].filter((id) => systems.has(id));
  const n = ids.length;
  const refusal = arrangeRefusal(n, ground.symmetry);
  if (refusal !== null) return refused(refusal, n);

  const selected = new Set(ids);
  const others = new Map([...systems].filter(([id]) => !selected.has(id)));
  const grid = new SpatialGrid();
  grid.build(others.values());
  const outside = new PlacementGround(others, grid, SYMMETRY_OFF);
  const rebuild = pending.purpose.lanes === "rebuild";
  const laid: PendingShape = {
    ...pending,
    fill: fillFor(pending.fill, n),
    lanes: NO_LANES,
    skipNear: false,
  };
  const spacing = laid.fill.kind === "outline" ? undefined : arrangeSpacing(laid, rules, n);
  if (spacing === null) return refused(arrangeTooSmall(n), n);
  const shapeGround = {
    placement: outside,
    extent: ground.extent,
    rules: { ...rules, cap: n },
    starWeights: null,
    laneDensity: ground.laneDensity,
  };
  const placed = shapePlacement(laid, shapeGround, spacing);
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
  const kept = pending.purpose.lanes === "keep" ? [...inner, ...outer] : outer;
  const keptShown = kept.map(([a, b]) => pairOf(shownId(a), shownId(b)));
  const stretched: Array<Segment<MeshPoint>> = keptShown.map(([a, b]) => ({
    a: { id: a, ...shownAt(a) },
    b: { id: b, ...shownAt(b) },
  }));

  let laidPairs: Pair[] = [];
  if (rebuild) {
    const withLanes = { ...laid, lanes: pending.lanes };
    const around = { ...shapeGround, placement: new FollowGround(outside, stretched) };
    const outerSet = new PairSet();
    for (const [a, b] of outer) outerSet.add(a, b);
    laidPairs = shapePlacement(withLanes, around, spacing).pairs.filter(([a, b]) => {
      const [x, y] = [realId(a), realId(b)];
      return !outerSet.has(x, y) && !prevented(systems, x, y);
    });
  }
  const laidReal = new PairSet();
  for (const [a, b] of laidPairs) laidReal.add(realId(a), realId(b));
  const innerSet = new PairSet();
  for (const [a, b] of inner) innerSet.add(a, b);
  const cut = pending.purpose.lanes === "keep" ? [] : inner.filter(([a, b]) => !laidReal.has(a, b));
  const added = laidReal.sorted().filter(([a, b]) => !innerSet.has(a, b));
  const keptAgain = rebuild ? inner.filter(([a, b]) => laidReal.has(a, b)) : [];

  const shown = new PairSet();
  for (const [a, b] of [...keptShown, ...laidPairs]) shown.add(a, b);
  for (const [a, b] of keptAgain) shown.add(shownId(a), shownId(b));
  const lanes = new SegmentIndex();
  for (const { a, b } of laneSegments(others.values())) lanes.add(a, b);
  for (const [a, b] of shown.values()) lanes.add(shownAt(a), shownAt(b));
  const crossing = keptShown.filter(([a, b]) => lanes.crosses(shownAt(a), shownAt(b)));

  return {
    ...placed,
    pairs: shown.sorted(),
    arranged: { count: n, moves, cut, added, crossing: crossing.sort(comparePairs), refusal: null },
  };
}
