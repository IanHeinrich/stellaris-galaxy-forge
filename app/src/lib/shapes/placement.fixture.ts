import type { SystemNode } from "../../generated/SystemNode";
import { byId } from "../../test/builders";
import { DEFAULT_LANE_DENSITY } from "../geometry/mesh";
import type { Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { segmentsCross } from "../geometry/segments";
import type { Symmetry } from "../geometry/symmetry";
import { reachOf, type MapExtent } from "../guides";
import { PlacementGround } from "../placement/ground";
import { laneSegments, provisionalIndex } from "../placement/lanes";
import { PLACEMENT_RULES, type PlacementRules } from "../placement/rules";
import { SpatialGrid } from "../spatialGrid";
import { NO_EXTRAS } from "./extras";
import type { CircleShape, PendingShape, Shape, ShapeGround, ShapePreview } from "./types";

export const OFF: Symmetry = { kind: "off" };

export const STATEMENTS = PLACEMENT_RULES.statements;
export const ROLLED = PLACEMENT_RULES.rolled;

export function groundOf(
  systems: SystemNode[],
  symmetry: Symmetry = OFF,
  rules: PlacementRules = STATEMENTS,
): ShapeGround {
  const grid = new SpatialGrid();
  grid.build(systems);
  return {
    placement: new PlacementGround(byId(...systems), grid, symmetry),
    extent: reachOf(rules.edge, 500) as MapExtent,
    rules,
    laneDensity: DEFAULT_LANE_DENSITY,
    starWeights: null,
  };
}

export const EMPTY = groundOf([]);

export function circle(over: Partial<CircleShape> = {}): CircleShape {
  return {
    kind: "circle",
    centre: { x: 0, y: 0 },
    radius: 200,
    rotation: 0,
    sweep: 360,
    squash: 100,
    hollow: 0,
    ...over,
  };
}

export function pending(shape: Shape, over: Partial<PendingShape> = {}): PendingShape {
  return {
    purpose: { kind: "add" },
    shape,
    fill: { kind: "outline", count: 24 },
    lanes: { follow: true, mode: "off", islands: false },
    extras: NO_EXTRAS,
    skipNear: true,
    seed: 7,
    stars: { kind: "random" },
    ...over,
  };
}

/** Where each end of the preview's lanes stands. */
export function positions(preview: ShapePreview, systems: SystemNode[] = []): (id: number) => Pt {
  const byIds = byId(...systems);
  return (id) => (id < 0 ? preview.points[provisionalIndex(id)] : byIds.get(id)!);
}

/** How many pairs of lanes cross, among the preview's own and between them and the galaxy's. */
export function crossings(preview: ShapePreview, systems: SystemNode[] = []): number {
  const at = positions(preview, systems);
  const existing = laneSegments(systems);
  const lanes = preview.pairs.map(([a, b]) => [at(a), at(b)]);
  let n = 0;
  lanes.forEach(([a, b], i) => {
    for (const { a: c, b: d } of existing) if (segmentsCross(a, b, c, d)) n++;
    for (const [c, d] of lanes.slice(i + 1)) if (segmentsCross(a, b, c, d)) n++;
  });
  return n;
}

export const key = ([a, b]: Pair) => `${a},${b}`;

/** How many groups of new points the preview's lanes join. */
export function components(preview: ShapePreview): number {
  const parent = preview.points.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const [a, b] of preview.pairs) {
    if (a < 0 && b < 0) parent[root(provisionalIndex(a))] = root(provisionalIndex(b));
  }
  return new Set(parent.map((_, i) => root(i))).size;
}
