import type { Capabilities } from "../../generated/Capabilities";
import type { DocumentKind } from "../../generated/DocumentKind";
import type { SpecialKind } from "../../generated/SpecialKind";
import { DOCUMENT_KINDS } from "../documentKinds";

export const LAYER_IDS = [
  "nebulae",
  "lanes",
  "owners",
  "bypasses",
  "systems",
  "classes",
  "heights",
  "issues",
  "labels",
  "initializers",
  "spawns",
  "feZones",
  "marauders",
  "mapBorder",
  "lCluster",
  "details",
  "orbitRadii",
  "colonies",
  "claims",
  "day_one_bypasses",
  "special",
  "precursors",
  "waylines",
  "watchlist",
  "highlights",
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

/**
 * The layers the system scene draws, each switched there apart from the galaxy, with what the
 * scene starts with. `sceneOnly` marks one the galaxy map does not draw, and `needs` the
 * capability without which the scene draws nothing for it.
 */
const SCENE_LAYERS = [
  { id: "labels", on: true },
  { id: "details", on: true },
  { id: "nebulae", on: true },
  { id: "bypasses", on: true, needs: "bypasses" },
  { id: "orbitRadii", on: false, sceneOnly: true },
] as const satisfies readonly {
  id: LayerId;
  on: boolean;
  sceneOnly?: true;
  needs?: keyof Capabilities;
}[];

type SceneLayer = (typeof SCENE_LAYERS)[number];
export type SceneLayerId = SceneLayer["id"];
export const SCENE_LAYER_IDS: readonly SceneLayerId[] = SCENE_LAYERS.map((layer) => layer.id);

export function isSceneLayer(id: LayerId): id is SceneLayerId {
  return (SCENE_LAYER_IDS as readonly LayerId[]).includes(id);
}

/** Whether the system scene draws anything for switch `id` in a document with `capabilities`. */
export function sceneDraws(id: SceneLayerId, capabilities: Capabilities): boolean {
  const layer: SceneLayer | undefined = SCENE_LAYERS.find((one) => one.id === id);
  return layer === undefined || !("needs" in layer) || capabilities[layer.needs];
}

/** The layers only the system scene draws; the galaxy's menus list them as switches of their own. */
export const SCENE_ONLY_IDS: readonly LayerId[] = SCENE_LAYERS.filter(
  (layer) => "sceneOnly" in layer,
).map((layer) => layer.id);

/** The layers the galaxy map switches: every layer but the ones only the system scene draws. */
export type GalaxyLayerId = Exclude<LayerId, Extract<SceneLayer, { sceneOnly: true }>["id"]>;
export type GalaxyLayers = Record<GalaxyLayerId, boolean>;

export function isGalaxyLayer(id: LayerId): id is GalaxyLayerId {
  return !SCENE_ONLY_IDS.includes(id);
}

/** What the system scene starts with: names, resources, clouds and wormholes drawn, radii not. */
export const DEFAULT_SCENE_LAYERS = Object.fromEntries(
  SCENE_LAYERS.map((layer) => [layer.id, layer.on]),
) as Record<SceneLayerId, boolean>;

export const GALAXY_LAYER_IDS: readonly GalaxyLayerId[] = LAYER_IDS.filter(isGalaxyLayer);

/** The layers with their own icon toggle in the top bar. */
export const PRIMARY_LAYERS: readonly LayerId[] = [
  "lanes",
  "systems",
  "labels",
  "spawns",
  "details",
  "owners",
  "bypasses",
  "nebulae",
  "orbitRadii",
];

/** The point-of-interest kinds with their own icon toggle in the top bar. */
export const PRIMARY_KINDS: readonly SpecialKind[] = ["leviathan", "enclave"];

/** What the number keys 1–9 toggle, in order; the spawn points have none left to take. */
export const LAYER_KEYS: readonly GalaxyLayerId[] = [
  "lanes",
  "systems",
  "labels",
  "details",
  "owners",
  "bypasses",
  "special",
  "nebulae",
  "issues",
];

/** The Layers menu, in its groups. */
export const LAYER_GROUPS: ReadonlyArray<{ label: string; layers: readonly LayerId[] }> = [
  {
    label: "Map",
    layers: [
      "lanes",
      "systems",
      "classes",
      "labels",
      "details",
      "orbitRadii",
      "colonies",
      "heights",
    ],
  },
  {
    label: "Overlays",
    layers: [
      "owners",
      "claims",
      "day_one_bypasses",
      "bypasses",
      "waylines",
      "special",
      "precursors",
      "watchlist",
      "initializers",
      "spawns",
      "feZones",
      "marauders",
      "nebulae",
      "mapBorder",
      "lCluster",
    ],
  },
  { label: "Editing", layers: ["issues"] },
];

/** What the layers panel calls each layer, in the game's own words. */
export const LAYER_LABELS: Record<LayerId, string> = {
  nebulae: "Nebulae",
  lanes: "Hyperlanes",
  owners: "Empires",
  bypasses: "Bypasses",
  waylines: "Waylines",
  systems: "Systems",
  classes: "Star classes",
  heights: "Heights",
  special: "Points of interest",
  precursors: "Precursors",
  initializers: "Initializer keys",
  spawns: "Spawn points",
  feZones: "Fallen empire zones",
  marauders: "Marauder clans",
  mapBorder: "Map border",
  lCluster: "L-Cluster",
  issues: "Issue highlights",
  labels: "Names",
  details: "System details",
  orbitRadii: "Orbit radii",
  colonies: "Colonies",
  claims: "Day-one claims",
  day_one_bypasses: "Day-one bypasses",
  watchlist: "Pinned searches",
  highlights: "Highlights",
};

/**
 * The layers without a number key of their own, each on the key of a layer that is not shown
 * where it is.
 */
export const BORROWED_KEYS: Readonly<Partial<Record<LayerId, LayerId>>> = { orbitRadii: "systems" };

/** What is on when the app starts: what a scenario opens with. */
export const DEFAULT_LAYERS: GalaxyLayers = DOCUMENT_KINDS.scenario.layers;

/** What a document of `kind` opens with, under whatever the user has since set by hand. */
export function defaultLayers(kind: DocumentKind): GalaxyLayers {
  return { ...DOCUMENT_KINDS[kind].layers };
}
