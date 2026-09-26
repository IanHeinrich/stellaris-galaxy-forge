import type { DocumentKind } from "../../generated/DocumentKind";
import type { SpecialKind } from "../../generated/SpecialKind";

export const LAYER_IDS = [
  "nebulae",
  "lanes",
  "owners",
  "bypasses",
  "systems",
  "classes",
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
  "waylines",
  "watchlist",
  "highlights",
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

/**
 * The layers the system scene draws, each switched there apart from the galaxy, with what the
 * scene starts with. `sceneOnly` marks one the galaxy map does not draw.
 */
const SCENE_LAYERS = [
  { id: "labels", on: true },
  { id: "details", on: true },
  { id: "nebulae", on: true },
  { id: "orbitRadii", on: false, sceneOnly: true },
] as const satisfies readonly { id: LayerId; on: boolean; sceneOnly?: true }[];

type SceneLayer = (typeof SCENE_LAYERS)[number];
export type SceneLayerId = SceneLayer["id"];
export const SCENE_LAYER_IDS: readonly SceneLayerId[] = SCENE_LAYERS.map((layer) => layer.id);

export function isSceneLayer(id: LayerId): id is SceneLayerId {
  return (SCENE_LAYER_IDS as readonly LayerId[]).includes(id);
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

/** What the system scene starts with: names, resources and nebula clouds drawn, radii not. */
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
    layers: ["lanes", "systems", "classes", "labels", "details", "orbitRadii", "colonies"],
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
  special: "Points of interest",
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

/** What is on when the app starts, and what a scenario opens with: the map as the game first
 * shows it, with the scripts' day-one overlays left off until asked for, and the two guides on
 * because a scenario is drawn to fit them. `special` is always on because the shown
 * point-of-interest kinds decide what that layer draws. */
export const DEFAULT_LAYERS: GalaxyLayers = {
  nebulae: false,
  lanes: true,
  owners: true,
  bypasses: true,
  waylines: false,
  systems: true,
  classes: true,
  special: true,
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

/** What a save opens with: the galaxy map the game itself draws, with star classes and colonies. */
const SAVE_LAYERS: GalaxyLayers = {
  nebulae: true,
  lanes: true,
  owners: true,
  bypasses: false,
  waylines: false,
  systems: true,
  classes: true,
  special: false,
  initializers: false,
  spawns: false,
  feZones: false,
  marauders: false,
  mapBorder: false,
  lCluster: false,
  issues: false,
  labels: true,
  details: true,
  colonies: true,
  claims: false,
  day_one_bypasses: false,
  watchlist: true,
  highlights: true,
};

/** What a document of `kind` opens with, under whatever the user has since set by hand. */
export function defaultLayers(kind: DocumentKind): GalaxyLayers {
  return { ...(kind === "save" ? SAVE_LAYERS : DEFAULT_LAYERS) };
}
