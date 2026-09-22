import { isLinked, linkSegment, takesCustomLinks, type Segment } from "../../lib/feLinks";
import type { LaneRef } from "../../store/editorStore";
import type { Systems } from "../RenderContext";

/** A segment the pointer can be on: a hyperlane, or the line a zone's link is drawn along. */
export type MapEdge =
  { kind: "lane"; lane: LaneRef } | { kind: "feLink"; anchor: number; system: number };

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
