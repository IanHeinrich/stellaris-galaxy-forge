import type { DocumentKind } from "../generated/DocumentKind";
import type { Guide } from "../generated/Guide";
import type { SystemNode } from "../generated/SystemNode";

/** Half the side of the square a scenario's coordinates must fall in, in world units. */
export const SCENARIO_HALF_EXTENT = 500;

/** The edge a document's systems stay inside: a save's galaxy circle or a scenario's square. */
export type MapExtent = { shape: "circle"; radius: number } | { shape: "square"; half: number };

const SCENARIO_SQUARE: MapExtent = { shape: "square", half: SCENARIO_HALF_EXTENT };

/** The edge of the map: a save's galaxy radius, null when it records none, else the scenario square. */
export function mapExtent(kind: DocumentKind | null, radius: number): MapExtent | null {
  if (kind !== "save") return SCENARIO_SQUARE;
  return radius > 0 ? { shape: "circle", radius } : null;
}

/** How far from the origin the map reaches: its circle's radius, or out to its square's corners. */
export function mapReach(kind: DocumentKind | null, radius: number): number {
  const extent = mapExtent(kind, radius) ?? SCENARIO_SQUARE;
  return extent.shape === "circle" ? extent.radius : extent.half * Math.SQRT2;
}

/** Where the game builds the L-Cluster for every galaxy size: `sgf_core::guides::L_CLUSTER`. */
export const L_CLUSTER: Guide = { x: -392.4, y: -392.4, radius: 90 };

/** Room left around a save's L-Cluster systems, so the circle reads as a region and not a hull. */
const L_CLUSTER_MARGIN = 15;
const L_CLUSTER_MIN_RADIUS = 30;

/** Whether the initializer or a star flag marks a save's system as part of the L-Cluster. */
export function isLClusterSystem(system: SystemNode): boolean {
  return (
    system.initializer.startsWith("lcluster") || system.flags.some((f) => f.startsWith("lcluster"))
  );
}

/**
 * The circle the L-Cluster guide draws: for a scenario the game's fixed one, and for a save the
 * circle about the systems marked as the cluster, falling back to the fixed one when it has none.
 */
export function lClusterGuide(kind: DocumentKind | null, systems: Iterable<SystemNode>): Guide {
  if (kind !== "save") return L_CLUSTER;
  const members = [...systems].filter(isLClusterSystem);
  if (members.length === 0) return L_CLUSTER;
  const xs = members.map((s) => s.x);
  const ys = members.map((s) => s.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const reach = Math.max(...members.map((s) => Math.hypot(s.x - x, s.y - y)));
  return { x, y, radius: Math.max(L_CLUSTER_MIN_RADIUS, reach + L_CLUSTER_MARGIN) };
}
