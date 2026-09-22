import type { SystemNode } from "../../generated/SystemNode";
import { distToSegmentSq } from "../geometry/geometry";
import type { MeshPoint } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import type { SpatialGrid } from "../spatialGrid";
import { PointGrid } from "./grid";
import type { Pair } from "./lanes";
import { isSpecialSystem } from "./special";

export interface Swept {
  /** Systems the stroke removes, ascending. */
  doomed: number[];
  /** Special systems under the stroke that it leaves, ascending. */
  kept: number[];
}

export interface SweepOptions {
  isSpecial?: (s: SystemNode) => boolean;
  includeSpecials?: boolean;
}

/** The systems within `r` of any stamp, split into those an eraser removes and the specials it spares. */
export function sweptSystems(
  stamps: readonly Pt[],
  r: number,
  grid: SpatialGrid,
  { isSpecial = isSpecialSystem, includeSpecials = false }: SweepOptions = {},
): Swept {
  const r2 = r * r;
  const hit = new Map<number, SystemNode>();
  for (const s of stamps) {
    grid.forEachIn(s.x - r, s.y - r, s.x + r, s.y + r, (n) => {
      const dx = n.x - s.x;
      const dy = n.y - s.y;
      if (dx * dx + dy * dy <= r2) hit.set(n.id, n);
    });
  }
  const doomed: number[] = [];
  const kept: number[] = [];
  for (const n of hit.values()) {
    (includeSpecials || !isSpecial(n) ? doomed : kept).push(n.id);
  }
  return { doomed: doomed.sort((a, b) => a - b), kept: kept.sort((a, b) => a - b) };
}

/** The lanes passing within `r` of any stamp centre, as [min, max] id pairs, ascending. */
export function sweptLanes(
  stamps: readonly Pt[],
  r: number,
  lanes: readonly (readonly [MeshPoint, MeshPoint])[],
): Pair[] {
  const index = new PointGrid(r);
  for (const s of stamps) index.add(s);
  const r2 = r * r;
  const cut = new Map<string, Pair>();
  for (const [a, b] of lanes) {
    const touched = index.someInBox(
      Math.min(a.x, b.x) - r,
      Math.min(a.y, b.y) - r,
      Math.max(a.x, b.x) + r,
      Math.max(a.y, b.y) + r,
      (s) => distToSegmentSq(s.x, s.y, a.x, a.y, b.x, b.y) <= r2,
    );
    if (!touched) continue;
    const pair: Pair = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    cut.set(`${pair[0]},${pair[1]}`, pair);
  }
  return [...cut.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
