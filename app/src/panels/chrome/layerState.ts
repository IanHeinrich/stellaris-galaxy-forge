import type { SpecialKind } from "../../generated/SpecialKind";
import { documentCapabilities } from "../../lib/capabilities";
import { shortcutLabel } from "../../lib/keys";
import { kindLabel } from "../../lib/special";
import { barShows, onSceneSwitch } from "../../lib/visual/barMode";
import { isGalaxyLayer, type LayerId } from "../../lib/visual/layerIds";
import {
  groupState,
  splitsBySource,
  type Group,
  type GroupState,
  type Source,
} from "../../lib/visual/layerGroups";
import { layerIdsFor } from "../../map/layers/registry";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useBarMode } from "../../store/sceneStore";

export type Pressed = "true" | "false" | "mixed";

/**
 * A layer's switch as the map shown answers it: while a system is up, the scene's own switch
 * for a layer it draws.
 */
export function useLayerSwitch(id: LayerId): { on: boolean; toggle: () => void } {
  const mode = useBarMode();
  const on = useMapChromeStore((s) => {
    if (onSceneSwitch(mode, id)) return s.sceneLayers[id];
    return isGalaxyLayer(id) && s.layers[id];
  });
  const toggleLayer = useMapChromeStore((s) => s.toggleLayer);
  const toggleSceneLayer = useMapChromeStore((s) => s.toggleSceneLayer);
  const toggle = () => {
    if (onSceneSwitch(mode, id)) toggleSceneLayer(id);
    else if (isGalaxyLayer(id)) toggleLayer(id);
  };
  return { on, toggle };
}

export function kindsLabel(kind: SpecialKind): string {
  return `${kindLabel(kind)}s`;
}

/** The key that flips each master; the scenario is the document itself and has none. */
export const MASTER_KEYS: Record<Source, string> = {
  scenario: "",
  initializers: shortcutLabel("toggleInitializerLayers"),
  scripts: shortcutLabel("toggleScriptLayers"),
};

/** What a master's pill reads: it flips a whole group, not the one layer an icon carries. */
export const MASTER_PILL = "all";

/** What each source tints its frame, label, icons and chips: the scenario's own are untinted. */
const SOURCE_CLASS: Record<Source, string> = {
  scenario: "",
  initializers: " init",
  scripts: " src",
};

/** A frame's, a label's or a toggle's class, tinted by the source it draws for. */
export function sourced(base: string, source: Source | null): string {
  return source === null ? base : `${base}${SOURCE_CLASS[source]}`;
}

/** The open document's format, which the group table is a function of. */
export function useKind() {
  return useFileSessionStore((s) => s.kind);
}

/** Whether the bar and the menu split what the document says from what the scripts add. */
export function useSplit(): boolean {
  return useFileSessionStore((s) => splitsBySource(s.kind));
}

/** Whether the groups that read the install can answer for anything: it has been read. */
export function useScriptsReady(): boolean {
  return useGameDataStore((s) => s.status === "ready");
}

const GROUP_PRESSED: Record<GroupState, Pressed> = { on: "true", off: "false", mixed: "mixed" };

/** How much of a group is on: every layer of it, none of them, or some. */
export function useGroupPressed(group: Group): Pressed {
  const kind = useKind();
  return GROUP_PRESSED[useMapChromeStore((s) => groupState(s, kind, group.source))];
}

/** The layers the open document can answer for that the bar shown lists. */
export function useShownLayers(): ReadonlySet<LayerId> {
  const mode = useBarMode();
  const registered = layerIdsFor(useFileSessionStore(documentCapabilities));
  return new Set([...registered].filter((id) => barShows(mode, id)));
}

/** Whether there is a document to draw at all: with none, the bar carries nothing to toggle. */
export function useDocument(): boolean {
  return useFileSessionStore((s) => s.status === "ready");
}
