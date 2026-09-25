import type { ComponentType } from "react";
import type { Capabilities } from "../../../generated/Capabilities";
import type { EntityKind } from "../../../generated/EntityKind";
import { capabilityFor } from "../../../lib/entities";
import type { EntityRef, Entry } from "../../../store/inspectorStore";
import { CountryView } from "./CountryView";
import { EntityView } from "./EntityView";
import { LaneEntry, NebulaEntry, SystemEntry } from "./entries";
import { PlanetView } from "./PlanetView";
import { GalaxyView } from "../galaxy/GalaxyView";
import { SelectionView } from "../selection/SelectionView";

/** One entity's body, and the document capability it needs to be reachable. */
export interface InspectorView {
  readonly label: string;
  readonly component: ComponentType<{ entry: Entry }>;
  readonly requires?: keyof Capabilities;
}

/** An entity of `kind` drawn by `component`, reachable where the document has what the kind needs. */
function entity(
  kind: EntityKind,
  label: string,
  component: InspectorView["component"] = EntityView,
): InspectorView {
  return { label, component, requires: capabilityFor(kind) };
}

/** Every entity the inspector draws a body for, by the kind it is opened on. */
export const INSPECTOR_VIEWS: Record<EntityRef["kind"], InspectorView> = {
  galaxy: { label: "Galaxy", component: GalaxyView },
  selection: { label: "Selection", component: SelectionView },
  lane: { label: "Hyperlane", component: LaneEntry },
  nebula: { label: "Nebula", component: NebulaEntry },
  system: { label: "System", component: SystemEntry },
  planet: entity("planet", "Planet", PlanetView),
  colony: entity("colony", "Colony"),
  fleet: entity("fleet", "Fleet"),
  ship: entity("ship", "Ship"),
  starbase: entity("starbase", "Starbase"),
  megastructure: entity("megastructure", "Megastructure"),
  country: entity("country", "Country", CountryView),
  pop_group: entity("pop_group", "Pop group"),
  sector: entity("sector", "Sector"),
  deposit: entity("deposit", "Deposit"),
  nodelist: { label: "List", component: EntityView },
};
