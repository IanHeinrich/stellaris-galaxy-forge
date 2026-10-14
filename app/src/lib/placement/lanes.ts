import type { SystemNode } from "../../generated/SystemNode";
import { meshPairs, type MeshPoint } from "../geometry/mesh";
import { pairOf, type Pair } from "../geometry/pairs";
import { dist2, type Pt } from "../geometry/pt";
import { SegmentIndex, type Segment } from "../geometry/segments";
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

/** A new lane is at most this many spacings long. */
export const LANE_REACH = 3;

export interface MeshWithinOptions {
  beta: number;
  /** Longer edges are dropped; callers pass three times the stroke's spacing. */
  maxLength: number;
  /** Lanes no new edge may cross; sharing an endpoint is not a crossing. */
  existing: readonly Segment[];
  /** Which mesh edges are wanted at all, such as those touching a new point or not yet linked. */
  keep?: (a: number, b: number) => boolean;
}

/** The β-skeleton edges over `points` that `keep` wants, no longer than `maxLength` and crossing no existing lane. */
export function meshWithin(points: readonly MeshPoint[], options: MeshWithinOptions): Pair[] {
  const { beta, maxLength, existing, keep } = options;
  const at = new Map(points.map((p) => [p.id, p]));
  const lanes = new SegmentIndex();
  for (const { a, b } of existing) lanes.add(a, b);
  const max2 = maxLength * maxLength;
  return meshPairs([...points], beta).filter(([a, b]) => {
    if (keep && !keep(a, b)) return false;
    const p = at.get(a)!;
    const q = at.get(b)!;
    return dist2(p, q) <= max2 && !lanes.crosses(p, q);
  });
}

export interface StrokeLanesInput {
  /** The stroke's new points, under ids of the caller's choosing (see `withProvisionalIds`). */
  added: readonly MeshPoint[];
  /** Existing systems near the stroke, meshed with the new points in "nearby" mode. */
  nearby: readonly MeshPoint[];
  existing: readonly Segment[];
  beta: number;
  mode: LaneMode;
  maxLength: number;
}

/**
 * The lanes a paint stroke adds, each touching at least one new point. Meshing is planar, so
 * the new lanes never cross each other.
 */
export function strokeLanes(input: StrokeLanesInput): Pair[] {
  const { added, nearby, existing, beta, mode, maxLength } = input;
  if (mode === "off") return [];
  if (mode === "new") return meshWithin(added, { beta, maxLength, existing });
  const fresh = new Set(added.map((p) => p.id));
  return meshWithin([...added, ...nearby], {
    beta,
    maxLength,
    existing,
    keep: (a, b) => fresh.has(a) || fresh.has(b),
  });
}

export interface PlacedLanesInput {
  /** The new points, every copy's, in the order `imageOfNew` numbers them. */
  points: readonly Pt[];
  /** How many of `points`, from the start, are the first copy's: only they look for nearby systems. */
  base: number;
  mode: LaneMode;
  beta: number;
  spacing: number;
  ground: PlacementGround;
  imageOfNew: ImageOfNew;
}

/**
 * The lanes new points add, under their provisional ids: at most `LANE_REACH` spacings long and
 * crossing no existing lane. Under symmetry a lane goes in with all its images or not at all.
 */
export function placedLanes(input: PlacedLanesInput): Pair[] {
  const { points, base, mode, beta, spacing, ground, imageOfNew } = input;
  if (mode === "off" || points.length === 0) return [];
  const maxLength = LANE_REACH * spacing;
  const existing = ground.lanesNear(points, maxLength);
  const pairs = strokeLanes({
    added: withProvisionalIds(points),
    nearby: mode === "nearby" ? ground.systemsNear(points.slice(0, base), maxLength) : [],
    existing,
    beta,
    mode,
    maxLength,
  }).map(([a, b]) => pairOf(a, b));
  if (!ground.symmetric) return pairs;
  const inFirst = (id: number) => id < 0 && provisionalIndex(id) < base;
  const at = (id: number): Pt => (id < 0 ? points[provisionalIndex(id)] : ground.systems.get(id)!);
  return ground.symmetricLanes(
    pairs.filter(([a, b]) => inFirst(a) || inFirst(b)),
    imageOfNew,
    at,
    existing,
  );
}
