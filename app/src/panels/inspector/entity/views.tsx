import type { ComponentType } from "react";
import type { Capabilities } from "../../../generated/Capabilities";
import type { EntityRef, Entry } from "../../../store/inspectorStore";
import { CountryView } from "./CountryView";
import { EntityView } from "./EntityView";
import { LaneEntry, NebulaEntry, SystemEntry } from "./entries";
import { GalaxyView } from "../galaxy/GalaxyView";
import { SelectionView } from "../selection/SelectionView";

/** One entity's body, and the document capability it needs to be reachable. */
export interface InspectorView {
  readonly label: string;
  readonly component: ComponentType<{ entry: Entry }>;
  readonly requires?: keyof Capabilities;
}

/** An entity the generic view draws, with the capability the document must have for it. */
function entity(label: string, requires: keyof Capabilities): InspectorView {
  return { label, component: EntityView, requires };
}

/** Every entity the inspector draws a body for, by the kind it is opened on. */
export const INSPECTOR_VIEWS: Record<EntityRef["kind"], InspectorView> = {
  galaxy: { label: "Galaxy", component: GalaxyView },
  selection: { label: "Selection", component: SelectionView },
  lane: { label: "Hyperlane", component: LaneEntry },
  nebula: { label: "Nebula", component: NebulaEntry },
  system: { label: "System", component: SystemEntry },
  planet: entity("Planet", "details"),
  colony: entity("Colony", "details"),
  fleet: entity("Fleet", "details"),
  ship: entity("Ship", "details"),
  starbase: entity("Starbase", "details"),
  megastructure: entity("Megastructure", "details"),
  country: { label: "Country", component: CountryView, requires: "empires" },
  pop_group: entity("Pop group", "details"),
  sector: entity("Sector", "empires"),
  deposit: entity("Deposit", "details"),
  nodelist: { label: "List", component: EntityView },
};
