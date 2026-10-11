import type { ComponentType } from "react";
import type { Capabilities } from "../../../generated/Capabilities";
import type { SystemDetail } from "../../../generated/SystemDetail";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { supports } from "../../../lib/capabilities";
import {
  AmbientObjects,
  Belts,
  Bypasses,
  ClosedLanes,
  FeLinks,
  FeZone,
  Flags,
  FlagsIfAny,
  Initializer,
  Lanes,
  Marauder,
  Megastructures,
  MilitaryFleets,
  Planets,
  PlanetsOrResources,
  Scripts,
  Sites,
  SpawningInitializer,
  SpawnPoint,
  StarList,
  Station,
  UtilityFleets,
  WormholePair,
} from "./OverviewEntries";

/** What every overview section is drawn from. */
export interface OverviewProps {
  detail: SystemDetail;
  /** Undefined while the system's contents are still being read. */
  details: SystemDetails | undefined;
}

/** One section of a system's Overview, and what the document must support to show it. */
export interface OverviewSection {
  readonly component: ComponentType<OverviewProps>;
  readonly requires?: keyof Capabilities;
}

export type OverviewKey =
  | "lanes"
  | "closedLanes"
  | "spawn"
  | "feZone"
  | "feLinks"
  | "marauder"
  | "bypasses"
  | "wormholePair"
  | "initializer"
  | "spawningInitializer"
  | "planets"
  | "planetsOrResources"
  | "belts"
  | "station"
  | "megastructures"
  | "sites"
  | "military"
  | "utility"
  | "flags"
  | "flagsIfAny"
  | "starList"
  | "ambientObjects"
  | "scripts";

/** Every section a system's Overview can show. */
export const OVERVIEW_SECTIONS: Record<OverviewKey, OverviewSection> = {
  lanes: { component: Lanes },
  closedLanes: { component: ClosedLanes },
  spawn: { component: SpawnPoint, requires: "create_systems" },
  feZone: { component: FeZone, requires: "create_systems" },
  feLinks: { component: FeLinks, requires: "create_systems" },
  marauder: { component: Marauder, requires: "create_systems" },
  bypasses: { component: Bypasses },
  wormholePair: { component: WormholePair },
  initializer: { component: Initializer },
  spawningInitializer: { component: SpawningInitializer },
  planets: { component: Planets },
  planetsOrResources: { component: PlanetsOrResources },
  belts: { component: Belts },
  station: { component: Station },
  megastructures: { component: Megastructures },
  sites: { component: Sites },
  military: { component: MilitaryFleets, requires: "details" },
  utility: { component: UtilityFleets, requires: "details" },
  flags: { component: Flags },
  flagsIfAny: { component: FlagsIfAny },
  starList: { component: StarList },
  ambientObjects: { component: AmbientObjects },
  scripts: { component: Scripts, requires: "scripts" },
};

/** A system the document holds, as the save writes it: its lanes first, its contents after. */
const HELD_ORDER: readonly OverviewKey[] = [
  "lanes",
  "bypasses",
  "wormholePair",
  "planets",
  "belts",
  "station",
  "megastructures",
  "military",
  "utility",
  "flags",
  "initializer",
];

/**
 * A system whose bodies are rolled from its initializer: its roles first, then what the
 * initializer and scripts place, each shown only where there is something, then the initializer
 * itself, its lanes last.
 */
const ROLLED_ORDER: readonly OverviewKey[] = [
  "spawn",
  "feZone",
  "feLinks",
  "marauder",
  "wormholePair",
  "starList",
  "planetsOrResources",
  "belts",
  "station",
  "megastructures",
  "bypasses",
  "sites",
  "ambientObjects",
  "flagsIfAny",
  "spawningInitializer",
  "closedLanes",
  "scripts",
];

/** The Overview sections an open document can answer for, in order. */
export function overviewSectionsFor(capabilities: Capabilities): OverviewKey[] {
  const order = capabilities.rolled_layout ? ROLLED_ORDER : HELD_ORDER;
  return order.filter((key) => supports(capabilities, OVERVIEW_SECTIONS[key].requires));
}
