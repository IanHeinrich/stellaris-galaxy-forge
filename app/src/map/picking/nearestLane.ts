import type { SystemNode } from "../../generated/SystemNode";
import { distToSegmentSq } from "../../lib/geometry/geometry";
import type { LaneRef } from "../../store/editorStore";

/** The undirected lane closest to (x, y) within `maxDist`, scanning every lane entry. */
export function nearestLane(
  systems: ReadonlyMap<number, SystemNode>,
  x: number,
  y: number,
  maxDist: number,
): LaneRef | null {
  let best: LaneRef | null = null;
  let bestD2 = maxDist * maxDist;
  for (const a of systems.values()) {
    for (const lane of a.lanes) {
      const b = systems.get(lane.to);
      if (!b) continue;
      const d2 = distToSegmentSq(x, y, a.x, a.y, b.x, b.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = a.id < b.id ? { a: a.id, b: b.id } : { a: b.id, b: a.id };
      }
    }
  }
  return best;
}
