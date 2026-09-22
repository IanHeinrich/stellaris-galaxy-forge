import type { SystemNode } from "../../generated/SystemNode";
import { SegmentIndex } from "../geometry/joinIslands";
import { meshPairs, type MeshPoint } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";

/** Two ids, the smaller first. */
export type Pair = [number, number];

export type Segment = readonly [Pt, Pt];

/** Which lanes a paint stroke adds: none, among its new systems, or also to the systems near it. */
export type LaneMode = "off" | "new" | "nearby";

/** New points under provisional ids -1, -2, …, -n, so they never collide with a system id. */
export function withProvisionalIds(points: readonly Pt[]): MeshPoint[] {
  return points.map((p, i) => ({ id: -(i + 1), x: p.x, y: p.y }));
}

/** Every lane once, as its two endpoints, skipping lanes to systems not in `systems`. */
export function laneSegments(systems: Iterable<SystemNode>): Array<[MeshPoint, MeshPoint]> {
  const byId = new Map<number, SystemNode>();
  for (const s of systems) byId.set(s.id, s);
  const segments: Array<[MeshPoint, MeshPoint]> = [];
  for (const s of byId.values()) {
    for (const lane of s.lanes) {
      const t = byId.get(lane.to);
      if (t === undefined || t.id <= s.id) continue;
      segments.push([
        { id: s.id, x: s.x, y: s.y },
        { id: t.id, x: t.x, y: t.y },
      ]);
    }
  }
  return segments;
}

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
  for (const [a, b] of existing) lanes.add(a, b);
  const max2 = maxLength * maxLength;
  return meshPairs([...points], beta).filter(([a, b]) => {
    if (keep && !keep(a, b)) return false;
    const p = at.get(a)!;
    const q = at.get(b)!;
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    return dx * dx + dy * dy <= max2 && !lanes.crosses(p, q);
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
