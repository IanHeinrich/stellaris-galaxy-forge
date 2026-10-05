import type { Capabilities } from "../../generated/Capabilities";
import type { DocumentKind } from "../../generated/DocumentKind";
import { DOCUMENT_KINDS, type GalaxyBarMode } from "../documentKinds";
import type { KeyAction } from "../keys";
import {
  BORROWED_KEYS,
  LAYER_IDS,
  LAYER_KEYS,
  isGalaxyLayer,
  isSceneLayer,
  sceneDraws,
  type LayerId,
  type SceneLayerId,
} from "./layerIds";

/** Which bar the chrome shows: a save's galaxy map, a scenario's, or one system in its place. */
export type BarMode = GalaxyBarMode | "system";

export function barModeOf(kind: DocumentKind | null, inSystem: boolean): BarMode {
  if (inSystem) return "system";
  return DOCUMENT_KINDS[kind ?? "save"].barMode;
}

/**
 * What the bar shows besides the layers: the point-of-interest kind buttons, the masters over a
 * source's group, the tool rail with Select and undo and redo, the brush tools with the active
 * brush's options, and the symmetry under them.
 */
export type BarControl = LayerId | "kinds" | "masters" | "rail" | "tools" | "symmetry";

const GALAXY: readonly BarMode[] = [
  ...new Set(Object.values(DOCUMENT_KINDS).map((info) => info.barMode)),
];
const EVERYWHERE: readonly BarMode[] = [...GALAXY, "system"];
const SYSTEM: readonly BarMode[] = ["system"];

/** A layer shows on the galaxy's bars, the system's, or both, as the scene's layer list says. */
function layerModes(id: LayerId): readonly BarMode[] {
  if (!isSceneLayer(id)) return GALAXY;
  return isGalaxyLayer(id) ? EVERYWHERE : SYSTEM;
}

/**
 * The modes each control shows in. The document's capabilities narrow the layers further, and
 * its layer groups say which have a master.
 */
const BAR_MODES: Readonly<Record<BarControl, readonly BarMode[]>> = {
  ...(Object.fromEntries(LAYER_IDS.map((id) => [id, layerModes(id)])) as Record<
    LayerId,
    readonly BarMode[]
  >),
  kinds: GALAXY,
  masters: GALAXY,
  rail: EVERYWHERE,
  tools: GALAXY,
  symmetry: GALAXY,
};

/** The commands only some bars take; any other runs on every bar. */
const COMMAND_MODES: Readonly<Partial<Record<BarCommand, readonly BarMode[]>>> = {
  deleteSelection: GALAXY,
  selectAll: GALAXY,
  browseInitializers: GALAXY,
};

/** A key action, or a nudge of the selection by the arrow keys. */
export type BarCommand = KeyAction | "nudge";

/** Whether the bar `mode` takes `command`: the galaxy's edits wait while a system is shown. */
export function barTakes(mode: BarMode, command: BarCommand): boolean {
  return COMMAND_MODES[command]?.includes(mode) ?? true;
}

export function barShows(mode: BarMode, control: BarControl): boolean {
  return BAR_MODES[control].includes(mode);
}

/** Whether `mode` switches `id` on the system scene's own switch rather than the galaxy's. */
export function onSceneSwitch(mode: BarMode, id: LayerId): id is SceneLayerId {
  return mode === "system" && isSceneLayer(id);
}

/**
 * Whether the bar `mode` shows layer `id` for a document with `capabilities`: in a system, only a
 * switch the scene draws something for.
 */
export function barShowsLayer(mode: BarMode, id: LayerId, capabilities: Capabilities): boolean {
  if (!barShows(mode, id)) return false;
  return !onSceneSwitch(mode, id) || sceneDraws(id, capabilities);
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
