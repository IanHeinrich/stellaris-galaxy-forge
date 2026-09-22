import type { SystemNode } from "../generated/SystemNode";
import type { Pt } from "../lib/geometry/pt";

/** A system's previewed destination while it is being dragged. */
export interface MoveGhost {
  id: number;
  x: number;
  y: number;
}

/**
 * Where each lane touching a ghost is previewed: between two ghosts once when both ends move,
 * otherwise from the ghost to the unmoved neighbour's real position.
 */
export function ghostLaneSegments(
  systems: ReadonlyMap<number, SystemNode>,
  ghosts: readonly MoveGhost[],
): Array<[Pt, Pt]> {
  const ghostOf = new Map(ghosts.map((g) => [g.id, g]));
  const segments: Array<[Pt, Pt]> = [];
  for (const g of ghosts) {
    const moved = systems.get(g.id);
    if (!moved) continue;
    for (const lane of moved.lanes) {
      const other = ghostOf.get(lane.to);
      if (other) {
        if (g.id < lane.to) segments.push([g, other]);
        continue;
      }
      const n = systems.get(lane.to);
      if (n) segments.push([g, n]);
    }
  }
  return segments;
}
