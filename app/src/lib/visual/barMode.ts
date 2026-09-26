import type { DocumentKind } from "../../generated/DocumentKind";
import {
  BORROWED_KEYS,
  LAYER_IDS,
  LAYER_KEYS,
  isSceneLayer,
  type LayerId,
  type SceneLayerId,
} from "./layerIds";

/** Which bar the chrome shows: a save's galaxy map, a scenario's, or one system in its place. */
export type BarMode = "save" | "scenario" | "system";

export function barModeOf(kind: DocumentKind | null, inSystem: boolean): BarMode {
  if (inSystem) return "system";
  return kind === "scenario" ? "scenario" : "save";
}

/**
 * What the bar shows besides the layers: the point-of-interest kind buttons, the masters over a
 * source's group, and the tool rail with the active brush's options.
 */
export type BarControl = LayerId | "kinds" | "masters" | "tools";

const GALAXY: readonly BarMode[] = ["save", "scenario"];
const EVERYWHERE: readonly BarMode[] = ["save", "scenario", "system"];
const SYSTEM: readonly BarMode[] = ["system"];

/** The modes each control shows in. The document's capabilities narrow the layers further. */
export const BAR_MODES: Readonly<Record<BarControl, readonly BarMode[]>> = {
  nebulae: EVERYWHERE,
  lanes: GALAXY,
  owners: GALAXY,
  bypasses: GALAXY,
  systems: GALAXY,
  classes: GALAXY,
  issues: GALAXY,
  labels: EVERYWHERE,
  initializers: GALAXY,
  spawns: GALAXY,
  feZones: GALAXY,
  marauders: GALAXY,
  mapBorder: GALAXY,
  lCluster: GALAXY,
  details: EVERYWHERE,
  orbitRadii: SYSTEM,
  colonies: GALAXY,
  claims: GALAXY,
  day_one_bypasses: GALAXY,
  special: GALAXY,
  waylines: GALAXY,
  watchlist: GALAXY,
  highlights: GALAXY,
  kinds: GALAXY,
  masters: ["scenario"],
  tools: GALAXY,
};

export function barShows(mode: BarMode, control: BarControl): boolean {
  return BAR_MODES[control].includes(mode);
}

/** Whether `mode` switches `id` on the system scene's own switch rather than the galaxy's. */
export function onSceneSwitch(mode: BarMode, id: LayerId): id is SceneLayerId {
  return mode === "system" && isSceneLayer(id);
}

/** The layer number key `index` switches in `mode`, or null where that key does nothing. */
export function layerAtKey(index: number, mode: BarMode): LayerId | null {
  const owner = LAYER_KEYS[index];
  if (owner === undefined) return null;
  const borrower = LAYER_IDS.find((id) => BORROWED_KEYS[id] === owner && barShows(mode, id));
  if (borrower !== undefined) return borrower;
  return barShows(mode, owner) ? owner : null;
}

/** The number key that switches `id` in `mode`, or 0 where none does. */
export function layerKey(id: LayerId, mode: BarMode): number {
  return LAYER_KEYS.findIndex((_, index) => layerAtKey(index, mode) === id) + 1;
}
