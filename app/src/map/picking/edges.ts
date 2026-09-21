import type { SystemNode } from "../../generated/SystemNode";
import { isLinked, linkSegment, takesCustomLinks, type Segment } from "../../lib/feLinks";
import { distToSegmentSq } from "../../lib/geometry/geometry";
import type { LaneRef } from "../../store/editorStore";
import type { Systems } from "../RenderContext";

/** A segment the pointer can be on: a hyperlane, or the line a zone's link is drawn along. */
export type MapEdge =
  { kind: "lane"; lane: LaneRef } | { kind: "feLink"; anchor: number; system: number };

/** Keeps the closest of the segments offered to it, within a tolerance of one point. */
class NearestSegment {
  private bestD2: number;

  constructor(
    private readonly x: number,
    private readonly y: number,
    maxDist: number,
  ) {
    this.bestD2 = maxDist * maxDist;
  }

  /** True when `a`–`b` is the closest segment offered so far. */
  closer(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const d2 = distToSegmentSq(this.x, this.y, a.x, a.y, b.x, b.y);
    if (d2 >= this.bestD2) return false;
    this.bestD2 = d2;
    return true;
  }
}

/** The undirected lane closest to (x, y) within `maxDist`, scanning every lane entry. */
export function nearestLane(
  systems: Systems,
  x: number,
  y: number,
  maxDist: number,
): LaneRef | null {
  const search = new NearestSegment(x, y, maxDist);
  let best: LaneRef | null = null;
  for (const a of systems.values()) {
    for (const lane of a.lanes) {
      const b = systems.get(lane.to);
      if (b && search.closer(a, b)) best = laneRef(a.id, b.id);
    }
  }
  return best;
}

/** The zone link drawn closest to (x, y) within `maxDist`: from a linked system to its anchor's ring. */
export function nearestFeLink(
  systems: Systems,
  x: number,
  y: number,
  maxDist: number,
): MapEdge | null {
  const takers = new Map<number, SystemNode[]>();
  for (const s of systems.values()) {
    if (takesCustomLinks(s)) takers.set(s.fe_link.id!, [...(takers.get(s.fe_link.id!) ?? []), s]);
  }
  if (takers.size === 0) return null;
  const search = new NearestSegment(x, y, maxDist);
  let best: MapEdge | null = null;
  for (const s of systems.values()) {
    for (const id of s.fe_link.to) {
      for (const anchor of takers.get(id) ?? []) {
        if (anchor.id === s.id) continue;
        const segment = linkSegment(anchor, s);
        if (segment && search.closer(segment.a, segment.b)) {
          best = { kind: "feLink", anchor: anchor.id, system: s.id };
        }
      }
    }
  }
  return best;
}

/** The closest edge within `maxDist`, a lane before a zone's link; links only count when `links`. */
export function nearestEdge(
  systems: Systems,
  x: number,
  y: number,
  maxDist: number,
  links: boolean,
): MapEdge | null {
  const lane = nearestLane(systems, x, y, maxDist);
  if (lane) return { kind: "lane", lane };
  return links ? nearestFeLink(systems, x, y, maxDist) : null;
}

/** Where `edge` is drawn, or null when the file no longer has it. */
export function edgeEnds(systems: Systems, edge: MapEdge | null): Segment | null {
  if (!edge) return null;
  if (edge.kind === "lane") {
    const a = systems.get(edge.lane.a);
    const b = systems.get(edge.lane.b);
    return a && b && a.lanes.some((l) => l.to === b.id) ? { a, b } : null;
  }
  const anchor = systems.get(edge.anchor);
  const system = systems.get(edge.system);
  if (!anchor || !system || !takesCustomLinks(anchor) || !isLinked(anchor, system)) return null;
  return linkSegment(anchor, system);
}

export function sameEdge(p: MapEdge | null, q: MapEdge | null): boolean {
  if (p === q) return true;
  if (p === null || q === null || p.kind !== q.kind) return false;
  if (p.kind === "lane" && q.kind === "lane") return sameLane(p.lane, q.lane);
  if (p.kind === "feLink" && q.kind === "feLink") {
    return p.anchor === q.anchor && p.system === q.system;
  }
  return false;
}

export function sameLane(p: LaneRef | null, q: LaneRef | null): boolean {
  return p === q || (p !== null && q !== null && p.a === q.a && p.b === q.b);
}

function laneRef(a: number, b: number): LaneRef {
  return a < b ? { a, b } : { a: b, b: a };
}
