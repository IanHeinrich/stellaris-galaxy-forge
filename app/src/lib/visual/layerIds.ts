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
  "details",
  "colonies",
  "claims",
  "day_one_bypasses",
  "special",
  "waylines",
  "highlights",
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

/** The plain on/off layers, as the Layers menu lists them. */
export const TOGGLEABLE_LAYERS: readonly LayerId[] = [
  "lanes",
  "systems",
  "classes",
  "labels",
  "details",
  "colonies",
  "owners",
  "claims",
  "bypasses",
  "waylines",
  "day_one_bypasses",
  "nebulae",
  "issues",
  "initializers",
];

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
];

/** The point-of-interest kinds with their own icon toggle in the top bar. */
export const PRIMARY_KINDS: readonly SpecialKind[] = ["leviathan", "enclave"];

/** What the number keys 1–9 toggle, in order; the spawn points have none left to take. */
export const LAYER_KEYS: readonly LayerId[] = [
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
  { label: "Map", layers: ["lanes", "systems", "classes", "labels", "details", "colonies"] },
  {
    label: "Overlays",
    layers: [
      "owners",
      "claims",
      "day_one_bypasses",
      "bypasses",
      "waylines",
      "special",
      "initializers",
      "spawns",
      "feZones",
      "nebulae",
    ],
  },
  { label: "Editing", layers: ["issues"] },
];

/** The number key that toggles a layer, or 0 for the layers without one. */
export function layerKey(id: LayerId): number {
  return LAYER_KEYS.indexOf(id) + 1;
}

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
  issues: "Issue highlights",
  labels: "Names",
  details: "System details",
  colonies: "Colonies",
  claims: "Day-one claims",
  day_one_bypasses: "Day-one bypasses",
  highlights: "Highlights",
};

/** What is on when the app starts, and what a scenario opens with: the map as the game first
 * shows it, with the scripts' day-one overlays left off until asked for. `special` is always on
 * because the shown point-of-interest kinds decide what that layer draws. */
export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
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
  issues: false,
  labels: true,
  details: true,
  colonies: true,
  claims: false,
  day_one_bypasses: false,
  highlights: true,
};

/** What a save opens with: the galaxy map the game itself draws, and nothing over it. */
const SAVE_LAYERS: Record<LayerId, boolean> = {
  nebulae: true,
  lanes: true,
  owners: true,
  bypasses: false,
  waylines: false,
  systems: true,
  classes: false,
  special: false,
  initializers: false,
  spawns: false,
  feZones: false,
  issues: false,
  labels: true,
  details: true,
  colonies: false,
  claims: false,
  day_one_bypasses: false,
  highlights: true,
};

/** What a document of `kind` opens with, under whatever the user has since set by hand. */
export function defaultLayers(kind: DocumentKind): Record<LayerId, boolean> {
  return { ...(kind === "save" ? SAVE_LAYERS : DEFAULT_LAYERS) };
}
