import type { SystemNode } from "../../generated/SystemNode";
import { islandLanes } from "../geometry/islandLanes";
import { delaunayPairs, meshPairs, type MeshPoint } from "../geometry/mesh";
import { comparePairs, pairOf, PairSet, type Pair } from "../geometry/pairs";
import { dist2, type Pt } from "../geometry/pt";
import { SegmentIndex, type Segment } from "../geometry/segments";
import { copies } from "../geometry/symmetry";
import { UnionFind } from "../geometry/unionFind";
import type { ImageOfNew, PlacementGround } from "./ground";

/** Which lanes a paint stroke adds: none, among its new systems, or also to the systems near it. */
export type LaneMode = "off" | "new" | "nearby";

export const LANE_MODES: readonly LaneMode[] = ["off", "new", "nearby"];

/** The provisional id of a stroke's new point `index`: -1, -2, …, so it never collides with a system id. */
export function provisionalId(index: number): number {
  return -(index + 1);
}

/** The index of the new point a provisional id names. */
export function provisionalIndex(id: number): number {
  return -id - 1;
}

/** New points under their provisional ids. */
export function withProvisionalIds(points: readonly Pt[]): MeshPoint[] {
  return points.map((p, i) => ({ id: provisionalId(i), x: p.x, y: p.y }));
}

/** Every lane once, as its two endpoints, skipping lanes to systems not in `systems`. */
export function laneSegments(systems: Iterable<SystemNode>): Array<Segment<MeshPoint>> {
  const byId = new Map<number, SystemNode>();
  for (const s of systems) byId.set(s.id, s);
  const segments: Array<Segment<MeshPoint>> = [];
  for (const s of byId.values()) {
    for (const lane of s.lanes) {
      const t = byId.get(lane.to);
      if (t === undefined || t.id <= s.id) continue;
      segments.push({ a: { id: s.id, x: s.x, y: s.y }, b: { id: t.id, x: t.x, y: t.y } });
    }
  }
  return segments;
}

/** Every lane of `systems`, indexed by where it runs. */
export function laneIndex(systems: ReadonlyMap<number, SystemNode>): SegmentIndex<MeshPoint> {
  const index = new SegmentIndex<MeshPoint>();
  for (const { a, b } of laneSegments(systems.values())) index.add(a, b);
  return index;
}

const indexed = new WeakMap<ReadonlyMap<number, SystemNode>, SegmentIndex<MeshPoint>>();

/** `laneIndex(systems)`, built once per galaxy and shared; callers only query it. */
export function sharedLaneIndex(systems: ReadonlyMap<number, SystemNode>): SegmentIndex<MeshPoint> {
  let index = indexed.get(systems);
  if (!index) {
    index = laneIndex(systems);
    indexed.set(systems, index);
  }
  return index;
}

/** A new lane is at most this many spacings long. */
export const LANE_REACH = 3;

export interface MeshWithinOptions {
  /** The Lane density slider's value, as `meshPairs` takes it. */
  density: number;
  /** Longer edges are dropped; callers pass three times the stroke's spacing. */
  maxLength: number;
  /** Lanes no new edge may cross; sharing an endpoint is not a crossing. */
  existing: readonly Segment[];
  /** Which mesh edges are wanted at all, such as those touching a new point or not yet linked. */
  keep?: (a: number, b: number) => boolean;
  /** Groups the lanes into islands as the game does, drawn under this seed; null or left out for the even mesh. */
  islandSeed?: number | null;
}

/**
 * The mesh edges over `points` that `keep` wants, no longer than `maxLength` and crossing no
 * existing lane. With `islandSeed`, the islands are grown over those edges alone.
 */
export function meshWithin(points: readonly MeshPoint[], options: MeshWithinOptions): Pair[] {
  const { density, maxLength, existing, keep, islandSeed = null } = options;
  const lanes = new SegmentIndex();
  for (const { a, b } of existing) lanes.add(a, b);
  const max2 = maxLength * maxLength;
  const usable = (p: MeshPoint, q: MeshPoint) =>
    (!keep || keep(p.id, q.id)) && dist2(p, q) <= max2 && !lanes.crosses(p, q);
  if (islandSeed !== null) {
    return islandLanes(points, density, islandSeed, usable).pairs;
  }
  const at = new Map(points.map((p) => [p.id, p]));
  return meshPairs(points, density).filter(([a, b]) => usable(at.get(a)!, at.get(b)!));
}

export interface StrokeLanesInput {
  /** The stroke's new points, under ids of the caller's choosing (see `withProvisionalIds`). */
  added: readonly MeshPoint[];
  /** Existing systems near the stroke, meshed with the new points in "nearby" mode. */
  nearby: readonly MeshPoint[];
  existing: readonly Segment[];
  density: number;
  mode: LaneMode;
  maxLength: number;
  /** Which lanes are wanted at all; islands grow over these alone. */
  keep?: (a: number, b: number) => boolean;
  /** Groups the lanes among new points into islands as the game does, under this seed; null or left out for the even mesh. */
  islandSeed?: number | null;
}

/**
 * The lanes a paint stroke adds, each touching at least one new point. Meshing is planar, so
 * the new lanes never cross each other. Islands join new points only, over a triangulation that
 * takes the nearby systems in too, so no island lane runs over one; the lanes to nearby systems
 * are the mesh's, less any that would cross an island's lane.
 */
export function strokeLanes(input: StrokeLanesInput): Pair[] {
  const { added, nearby, existing, density, mode, maxLength, keep, islandSeed = null } = input;
  if (mode === "off") return [];
  const fresh = new Set(added.map((p) => p.id));
  const wanted = (a: number, b: number) => !keep || keep(a, b);
  if (islandSeed === null) {
    if (mode === "new") return meshWithin(added, { density, maxLength, existing, keep });
    return meshWithin([...added, ...nearby], {
      density,
      maxLength,
      existing,
      keep: (a, b) => (fresh.has(a) || fresh.has(b)) && wanted(a, b),
    });
  }
  const all = [...added, ...nearby];
  const inner = meshWithin(all, {
    density,
    maxLength,
    existing,
    keep: (a, b) => fresh.has(a) && fresh.has(b) && wanted(a, b),
    islandSeed,
  });
  if (mode === "new") return inner;
  const at = new Map(all.map((p) => [p.id, p]));
  const laid = inner.map(([a, b]) => ({ a: at.get(a)!, b: at.get(b)! }));
  const links = meshWithin(all, {
    density,
    maxLength,
    existing: [...existing, ...laid],
    keep: (a, b) => fresh.has(a) !== fresh.has(b) && wanted(a, b),
  });
  return [...inner, ...links].sort(comparePairs);
}

export interface PlacedLanesInput {
  /** The new points, every copy's, in the order `imageOfNew` numbers them. */
  points: readonly Pt[];
  /** How many of `points`, from the start, are the first copy's: only they look for nearby systems. */
  base: number;
  mode: LaneMode;
  density: number;
  spacing: number;
  ground: PlacementGround;
  imageOfNew: ImageOfNew;
  /** Which lanes are wanted at all; under symmetry, every image of a lane must be. */
  keep?: (a: number, b: number) => boolean;
  /** Groups the lanes among new points into islands as the game does, under this seed; null for the even mesh. */
  islandSeed: number | null;
}

/**
 * The lanes new points add, under their provisional ids: at most `LANE_REACH` spacings long and
 * crossing no existing lane. Under symmetry a lane goes in with all its images or not at all,
 * so islands are grown over every copy, the first copy's lanes are mirrored onto the rest, and
 * `seamJoins` joins the copies again where a join across the seam was dropped.
 */
export function placedLanes(input: PlacedLanesInput): Pair[] {
  const { points, base, mode, density, spacing, ground, imageOfNew, keep, islandSeed } = input;
  if (mode === "off" || points.length === 0) return [];
  const maxLength = LANE_REACH * spacing;
  const existing = ground.lanesNear(points, maxLength);
  const pairs = strokeLanes({
    added: withProvisionalIds(points),
    nearby: mode === "nearby" ? ground.systemsNear(points.slice(0, base), maxLength) : [],
    existing,
    density,
    mode,
    maxLength,
    keep,
    islandSeed,
  }).map(([a, b]) => pairOf(a, b));
  if (!ground.symmetric) return pairs;
  const inFirst = (id: number) => id < 0 && provisionalIndex(id) < base;
  const at = (id: number): Pt => (id < 0 ? points[provisionalIndex(id)] : ground.systems.get(id)!);
  const mirrored = ground.symmetricLanes(
    pairs.filter(([a, b]) => inFirst(a) || inFirst(b)),
    imageOfNew,
    at,
    existing,
    keep,
  );
  if (islandSeed === null) return mirrored;
  const seams = { points, base, ground, imageOfNew, at, existing, keep, maxLength };
  return [...mirrored, ...seamJoins(mirrored, seams)].sort(comparePairs);
}

interface SeamGround {
  points: readonly Pt[];
  base: number;
  ground: PlacementGround;
  imageOfNew: ImageOfNew;
  at: (id: number) => Pt;
  existing: readonly Segment[];
  keep?: (a: number, b: number) => boolean;
  maxLength: number;
}

/**
 * The joins, each with all its images, that put the new points of a symmetric placement back
 * into one network with `laid`. A join between islands across a mirror crosses its own image,
 * so `symmetricLanes` drops it and the copies come apart. The candidates are the Delaunay edges
 * between new points apart and each first-copy point's lane to its own images, shortest first.
 */
function seamJoins(laid: readonly Pair[], seams: SeamGround): Pair[] {
  const { points, base, ground, imageOfNew, at, existing, keep, maxLength } = seams;
  const index = new Map<number, number>();
  const slot = (id: number) => {
    if (!index.has(id)) index.set(id, index.size);
    return index.get(id)!;
  };
  points.forEach((_, i) => slot(provisionalId(i)));
  const ends = new Set(laid.flat());
  for (const id of ends) slot(id);
  const sets = new UnionFind(index.size);
  for (const [a, b] of laid) sets.union(slot(a), slot(b));
  const apart = ([a, b]: Pair) => sets.find(slot(a)) !== sets.find(slot(b));

  const candidates = new PairSet();
  for (const [a, b] of delaunayPairs(withProvisionalIds(points))) candidates.add(a, b);
  for (let i = 0; i < base; i++) {
    for (let m = 1; m < copies(ground.symmetry); m++) {
      const j = imageOfNew(i, m);
      if (j !== null && j !== i) candidates.add(provisionalId(i), provisionalId(j));
    }
  }
  const length = ([a, b]: Pair) => dist2(at(a), at(b));
  const max2 = maxLength * maxLength;
  const ordered = [...candidates.values()]
    .filter((pair) => length(pair) <= max2)
    .sort((p, q) => length(p) - length(q) || comparePairs(p, q));

  const lanes = new SegmentIndex();
  for (const { a, b } of existing) lanes.add(a, b);
  for (const [a, b] of laid) lanes.add(at(a), at(b));
  const joins: Pair[] = [];
  for (const pair of ordered) {
    if (!apart(pair)) continue;
    const orbit = ground.symmetricLane(pair, imageOfNew, at, lanes, keep);
    for (const [a, b] of orbit) sets.union(slot(a), slot(b));
    joins.push(...orbit);
  }
  return joins;
}
