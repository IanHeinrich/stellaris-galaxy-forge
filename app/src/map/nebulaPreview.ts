import type { Nebula } from "../generated/Nebula";
import type { SystemNode } from "../generated/SystemNode";
import type { Systems } from "./RenderContext";
import type { SpatialGrid } from "../lib/spatialGrid";

/** The centre and radius a drag is proposing for one nebula. */
export interface NebulaGeometry {
  x: number;
  y: number;
  radius: number;
}

/** What the proposed geometry would do to the dragged nebula's membership. */
export interface NebulaPreview extends NebulaGeometry {
  /** Systems that would enter the dragged nebula, and those that would leave it. */
  joining: number[];
  leaving: number[];
  /** Members the nebula would have once the drag is applied. */
  total: number;
}

/**
 * Which cloud a point belongs to: among those covering it the nearest centre wins, the lower
 * file index breaking a tie. `nearest_covering` in
 * `crates/sgf-core/src/projections/galaxy/nebulae.rs` decides every op the same way.
 */
export function nearestCovering(
  discs: readonly NebulaGeometry[],
  x: number,
  y: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < discs.length; i++) {
    const n = discs[i];
    const d = Math.hypot(x - n.x, y - n.y);
    if (d <= n.radius && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * Membership as the core decides it, for the one nebula `index` carries `geometry` instead of
 * its own. Only the systems the cloud reaches before or after the drag can change hands, so the
 * scan is bounded by those two discs and the members the nebula lists; without a grid every
 * system is visited instead.
 */
export function nebulaPreview(
  systems: Systems,
  grid: SpatialGrid | null,
  nebulae: readonly Nebula[],
  index: number,
  geometry: NebulaGeometry,
): NebulaPreview {
  const discs = nebulae.map((n, i) => (i === index ? geometry : n));
  const joining: number[] = [];
  const leaving: number[] = [];
  let total = 0;
  const seen = new Set<number>();
  const visit = (s: SystemNode) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    const after = nearestCovering(discs, s.x, s.y);
    if (after === index) {
      total++;
      if (s.nebula !== index) joining.push(s.id);
    } else if (s.nebula === index) {
      leaving.push(s.id);
    }
  };
  const held = nebulae[index];
  if (grid === null) {
    for (const s of systems.values()) visit(s);
  } else {
    for (const disc of held === undefined ? [geometry] : [held, geometry]) {
      grid.forEachIn(
        disc.x - disc.radius,
        disc.y - disc.radius,
        disc.x + disc.radius,
        disc.y + disc.radius,
        visit,
      );
    }
  }
  for (const id of held?.systems ?? []) {
    const s = systems.get(id);
    if (s) visit(s);
  }
  joining.sort((a, b) => a - b);
  leaving.sort((a, b) => a - b);
  return { ...geometry, joining, leaving, total };
}
