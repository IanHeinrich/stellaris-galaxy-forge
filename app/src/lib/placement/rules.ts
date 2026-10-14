import type { Capabilities } from "../../generated/Capabilities";
import { SAVE_SHAPE_CAP, SPAWN_BUFFER } from "../../generated/constants";
import { documentCapabilities } from "../capabilities";
import type { MapEdge } from "../documentKinds";
import { extentOf, type MapExtent } from "../guides";
import { SAMPLE_CAP } from "./limits";

/** How a document's systems are written: a scenario's as statements, a save's rolled by the generator. */
export type PlacementPath = "statements" | "rolled";

/** What systems placed or moved on one path hold to. */
export interface PlacementRules {
  /** The most systems one shape places. */
  cap: number;
  /** The least distance between a new or moved system and any other. */
  minGap: number;
  /** The edge points past which are left out. */
  edge: MapEdge;
}

export const PLACEMENT_RULES: Record<PlacementPath, PlacementRules> = {
  statements: { cap: SAMPLE_CAP, minGap: 0, edge: "scenario_square" },
  rolled: { cap: SAVE_SHAPE_CAP, minGap: SPAWN_BUFFER, edge: "galaxy_radius" },
};

/**
 * The path a document with `c` writes its systems by, which holds a move as much as a placement:
 * a save that takes no added systems, such as a 3.x save, still keeps the spawn buffer and the
 * galaxy's edge when its systems move.
 */
export function systemsPath(c: Capabilities): PlacementPath {
  return c.create_systems ? "statements" : "rolled";
}

/** The path a shape takes into a document with `c`; null when it takes no shapes. */
export function placementPath(c: Capabilities): PlacementPath | null {
  if (!c.bulk_add_systems || (!c.create_systems && !c.added_systems)) return null;
  return systemsPath(c);
}

/** How the open document, with `capabilities`, takes a shape's systems; null when it takes none. */
export function shapePath(capabilities: Capabilities | null): PlacementPath | null {
  return placementPath(documentCapabilities({ capabilities }));
}

/** What a moved system stays within in a document: the map's edge, null when it records none, and the gap to others. */
export interface PlacementBounds {
  edge: MapExtent | null;
  gap: number;
}

/** The bounds of the open document, with `capabilities`, whose galaxy has `radius`. */
export function placementBounds(
  capabilities: Capabilities | null,
  radius: number,
): PlacementBounds {
  const rules = PLACEMENT_RULES[systemsPath(documentCapabilities({ capabilities }))];
  return { edge: extentOf(rules.edge, radius), gap: rules.minGap };
}
