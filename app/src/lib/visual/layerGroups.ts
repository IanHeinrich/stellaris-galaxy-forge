import type { DocumentKind } from "../../generated/DocumentKind";
import type { SpecialKind } from "../../generated/SpecialKind";
import { KIND_ORDER } from "../special";
import { LAYER_IDS, PRIMARY_KINDS, PRIMARY_LAYERS, type LayerId } from "./layerIds";

/** Where what the app draws comes from: the document's own statements, the key resolved through
 * game data, or the scripts that run on top of it. */
export type Source = "scenario" | "initializers" | "scripts";

export const SOURCES: readonly Source[] = ["scenario", "initializers", "scripts"];

/**
 * One band of the layer bar and one section of the Layers menu: the layers of one source, and
 * whether they answer to a master and need the install to draw anything at all.
 */
export interface Group {
  source: Source;
  label: string;
  layers: readonly LayerId[];
  master: boolean;
  needsGameData: boolean;
  /** Why the group is dead, for a group that needs the install and has not been given it. */
  deadTitle?: string;
}

/** The layers the bar carries an icon for: the primary ones, and the two only a scenario has. */
export const ICON_LAYERS: readonly LayerId[] = [...PRIMARY_LAYERS, "claims", "day_one_bypasses"];

/** The icons a framed group ends with, after the kinds its master also decides. */
export const TRAILING_ICONS: readonly LayerId[] = ["owners"];

/** The icons a framed group carries, split where the kinds go between them. */
export function frameIcons(
  group: Group,
  registered: ReadonlySet<LayerId>,
): { lead: LayerId[]; trail: LayerId[] } {
  const own = ICON_LAYERS.filter((id) => registered.has(id) && group.layers.includes(id));
  return {
    lead: own.filter((id) => !TRAILING_ICONS.includes(id)),
    trail: own.filter((id) => TRAILING_ICONS.includes(id)),
  };
}

/** The layers one group's "all" button stands over: the icons the bar carries for that group,
 * with the point-of-interest layer the kinds stand in for. The menu's own layers answer to it. */
export function barLayers(group: Group): LayerId[] {
  const { lead, trail } = frameIcons(group, new Set(group.layers));
  return [...lead, ...trail];
}

/** The point-of-interest kinds the bar carries buttons for, when the group holds that layer. */
export function barKinds(group: Group): readonly SpecialKind[] {
  return group.layers.includes("special") ? PRIMARY_KINDS : [];
}

/** What the bar and the menu head each group with. */
export const SOURCE_LABELS: Record<Source, string> = {
  scenario: "Scenario",
  initializers: "Initializers",
  scripts: "Scripts",
};

/** Why the scripts group is dead until the install has been read. */
export const NO_GAME_DATA_TITLE = "Load game data to see what the scripts add";

/** Why the initializers group is dead until the install has been read. */
export const NO_GAME_DATA_KEYS_TITLE = "Load game data to read what each initializer places";

const SCENARIO_GROUPS: readonly Group[] = [
  {
    source: "scenario",
    label: SOURCE_LABELS.scenario,
    layers: [
      "lanes",
      "systems",
      "labels",
      "nebulae",
      "initializers",
      "spawns",
      "feZones",
      "marauders",
      "mapBorder",
      "lCluster",
      "issues",
      "highlights",
    ],
    master: false,
    needsGameData: false,
  },
  {
    source: "initializers",
    label: SOURCE_LABELS.initializers,
    layers: ["classes", "special", "details", "colonies", "owners", "bypasses"],
    master: true,
    needsGameData: true,
    deadTitle: NO_GAME_DATA_KEYS_TITLE,
  },
  {
    source: "scripts",
    label: SOURCE_LABELS.scripts,
    layers: ["claims", "day_one_bypasses"],
    master: true,
    needsGameData: true,
    deadTitle: NO_GAME_DATA_TITLE,
  },
];

/** A save draws one source, so its layers are one unframed group with no master over them. */
const SAVE_GROUPS: readonly Group[] = [
  {
    source: "scenario",
    label: "Layers",
    layers: LAYER_IDS,
    master: false,
    needsGameData: false,
  },
];

/** The groups the open document's layers fall into; the only place the kind is consulted. */
export function groupsFor(kind: DocumentKind | null): readonly Group[] {
  return kind === "scenario" ? SCENARIO_GROUPS : SAVE_GROUPS;
}

/** How much of a group the map draws, for the one button that switches all of it. */
export type GroupState = "on" | "off" | "mixed";

/** The switches the map draws by, as much of them as a group's state is read from. */
export interface LayerVisibility {
  layers: Readonly<Record<LayerId, boolean>>;
  shownKinds: ReadonlySet<SpecialKind>;
}

/** What the map draws for one kind: its own toggle, under the layer that carries them all. */
export function kindVisible(state: LayerVisibility, kind: SpecialKind): boolean {
  return state.layers.special && state.shownKinds.has(kind);
}

/** Whether every point-of-interest kind is drawn. */
export function allKindsVisible(state: LayerVisibility): boolean {
  return state.layers.special && state.shownKinds.size === KIND_ORDER.length;
}

/** The layer's own switch; which point-of-interest kinds are shown is the layer's business. */
function layerState(state: LayerVisibility, id: LayerId): GroupState {
  return state.layers[id] ? "on" : "off";
}

/** How much of what one source decides the map draws: all of it, none of it, or some. */
export function groupState(
  state: LayerVisibility,
  kind: DocumentKind | null,
  source: Source,
): GroupState {
  const group = groupsFor(kind).find((one) => one.source === source);
  if (!group) return "off";
  const states = [
    ...barLayers(group).map((id) => layerState(state, id)),
    ...barKinds(group).map((k): GroupState => (kindVisible(state, k) ? "on" : "off")),
  ];
  if (states.every((one) => one === "on")) return "on";
  return states.every((one) => one === "off") ? "off" : "mixed";
}

/** Which group a layer sits in, or null where the document has only one. */
export function sourceOf(id: LayerId, kind: DocumentKind | null): Source | null {
  const groups = groupsFor(kind);
  if (groups.length < 2) return null;
  return groups.find((group) => group.layers.includes(id))?.source ?? null;
}

/** The source each inspector section is filled from, by section id. */
export const SECTION_SOURCES: Readonly<Record<string, Source>> = {
  "galaxy.counts": "scenario",
  "galaxy.header": "scenario",
  "galaxy.setup": "scenario",
  "system.position": "scenario",
  "system.hyperlanes": "scenario",
  "system.nebula": "scenario",
  "system.initializer": "initializers",
  "system.spawn": "scenario",
  "system.feZone": "scenario",
  "system.marauder": "scenario",
  "system.wormholePair": "scenario",
  "system.planets": "initializers",
  "system.resources": "initializers",
  "system.station": "initializers",
  "system.megastructures": "initializers",
  "system.sites": "initializers",
  "system.scripts": "scripts",
};

/** Sections a master never folds away: the controls that decide what its source derives from. */
export const UNFOLDED_SECTIONS: ReadonlySet<string> = new Set(["system.initializer"]);

/** The sections `source` fills, for the overrides a master flipping drops. */
export function sectionIdsOf(source: Source): string[] {
  return Object.keys(SECTION_SOURCES).filter(
    (id) => SECTION_SOURCES[id] === source && !UNFOLDED_SECTIONS.has(id),
  );
}

/** Whether the layer bar and the Layers menu split by source: a scenario document only. */
export function splitsBySource(kind: DocumentKind | null): boolean {
  return groupsFor(kind).length > 1;
}
