import type { Capabilities } from "../generated/Capabilities";
import type { DocumentKind } from "../generated/DocumentKind";
import type { SaveMeta } from "../generated/SaveMeta";
import { documentCapabilities, SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "./capabilities";
import { counted } from "./text";
import { versionShort } from "./version";
import type { GalaxyLayers } from "./visual/layerIds";

/** The bars a document's galaxy map can have; a system's own bar comes on top of these. */
export type GalaxyBarMode = "save" | "scenario";

/** How the layer bar and the Layers menu group a document's layers; `layerGroups` holds the groups. */
export type GroupLayout = "single" | "by_source";

/** What bounds the map's systems; `guides` holds the shapes. */
export type MapEdge = "galaxy_radius" | "scenario_square";

/** Where the L-Cluster guide is drawn; `guides` holds the circles. */
export type LClusterGuide = "marked_systems" | "fixed";

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** What differs between the kinds of document in data alone. A new kind fails to compile until its row is written. */
export interface DocumentKindInfo {
  /** The kind as a person names it; a row writes it in the casing it needs. */
  label: string;
  fileFilter: FileFilter;
  barMode: GalaxyBarMode;
  /** What the layers are set to when a document of the kind opens. */
  layers: GalaxyLayers;
  groups: GroupLayout;
  mapEdge: MapEdge;
  lCluster: LClusterGuide;
  /**
   * The kind's static table. Code that needs the open document's capabilities reads the
   * session's, which the core reports and which can differ from this (a pre-4.x save, say).
   */
  capabilities: Capabilities;
  /** A save's empire, date and version; a scenario's system count when one is given. */
  recentSubtitle(meta: SaveMeta | null, galaxySystems: number | undefined): string;
}

/** What a scenario opens with, and what is on when the app starts: the map as the game first
 * shows it, with the scripts' day-one overlays left off until asked for, and the two guides on
 * because a scenario is drawn to fit them. `special` is always on because the shown
 * point-of-interest kinds decide what that layer draws. */
const SCENARIO_LAYERS: GalaxyLayers = {
  nebulae: false,
  lanes: true,
  owners: true,
  bypasses: true,
  waylines: false,
  systems: true,
  classes: true,
  heights: true,
  special: true,
  precursors: false,
  initializers: true,
  spawns: true,
  feZones: true,
  marauders: true,
  mapBorder: true,
  lCluster: true,
  issues: false,
  labels: true,
  details: true,
  colonies: true,
  claims: false,
  day_one_bypasses: false,
  watchlist: true,
  highlights: true,
};

/** What a save opens with: the galaxy map the game itself draws, with star classes, colonies and
 * the two guides. */
const SAVE_LAYERS: GalaxyLayers = {
  nebulae: true,
  lanes: true,
  owners: true,
  bypasses: false,
  waylines: false,
  systems: true,
  classes: true,
  heights: true,
  special: false,
  precursors: false,
  initializers: false,
  spawns: false,
  feZones: false,
  marauders: false,
  mapBorder: true,
  lCluster: true,
  issues: false,
  labels: true,
  details: true,
  colonies: true,
  claims: false,
  day_one_bypasses: false,
  watchlist: true,
  highlights: true,
};

export const DOCUMENT_KINDS: Readonly<Record<DocumentKind, DocumentKindInfo>> = {
  save: {
    label: "Save",
    fileFilter: { name: "Stellaris save", extensions: ["sav"] },
    barMode: "save",
    layers: SAVE_LAYERS,
    groups: "single",
    mapEdge: "galaxy_radius",
    lCluster: "marked_systems",
    capabilities: SAVE_CAPABILITIES,
    recentSubtitle: (meta) =>
      meta === null
        ? ""
        : [meta.name, meta.date, versionShort(meta.version)].filter(Boolean).join(" · "),
  },
  scenario: {
    label: "Scenario",
    fileFilter: { name: "Stellaris static galaxy scenario", extensions: ["txt"] },
    barMode: "scenario",
    layers: SCENARIO_LAYERS,
    groups: "by_source",
    mapEdge: "scenario_square",
    lCluster: "fixed",
    capabilities: SCENARIO_CAPABILITIES,
    recentSubtitle: (_meta, galaxySystems) =>
      typeof galaxySystems === "number" ? counted(galaxySystems, "system") : "",
  },
};
/** What a document of `kind` supports, or what the app assumes while none is open. */
export function kindCapabilities(kind: DocumentKind | null): Capabilities {
  return documentCapabilities({
    capabilities: kind === null ? null : DOCUMENT_KINDS[kind].capabilities,
  });
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (Object.keys(DOCUMENT_KINDS) as string[]).includes(value);
}
