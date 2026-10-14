import type { Capabilities } from "../../generated/Capabilities";
import { SAVE_SHAPE_CAP, SPAWN_BUFFER } from "../../generated/constants";
import type { MapEdge } from "../documentKinds";
import { SAMPLE_CAP } from "../placement/limits";

/** How a shape's systems reach the document: a scenario's as statements, a save's rolled by the generator. */
export type PlacementPath = "statements" | "rolled";

/** What a shape's placement holds to on one path. */
export interface PlacementRules {
  /** The most systems one shape places. */
  cap: number;
  /** The least distance between a new system and any other, new or existing. */
  minGap: number;
  /** The edge points past which are left out. */
  edge: MapEdge;
}

export const PLACEMENT_RULES: Record<PlacementPath, PlacementRules> = {
  statements: { cap: SAMPLE_CAP, minGap: 0, edge: "scenario_square" },
  rolled: { cap: SAVE_SHAPE_CAP, minGap: SPAWN_BUFFER, edge: "galaxy_radius" },
};

/** The path a shape takes into a document with `c`; null when it takes no shapes. */
export function placementPath(c: Capabilities): PlacementPath | null {
  if (!c.bulk_add_systems) return null;
  if (c.create_systems) return "statements";
  return c.added_systems ? "rolled" : null;
}
