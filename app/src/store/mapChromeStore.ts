import { create } from "zustand";
import type { DocumentKind } from "../generated/DocumentKind";
import type { SpecialKind } from "../generated/SpecialKind";
import { DEFAULT_LANE_DENSITY, densityOfBeta } from "../lib/geometry/mesh";
import type { Pt } from "../lib/geometry/pt";
import { KIND_ORDER, kindOrder } from "../lib/special";
import {
  DEFAULT_LAYERS,
  DEFAULT_SCENE_LAYERS,
  GALAXY_LAYER_IDS,
  LAYER_KEYS,
  SCENE_LAYER_IDS,
  defaultLayers,
  type GalaxyLayerId,
  type GalaxyLayers,
  type SceneLayerId,
} from "../lib/visual/layerIds";
import {
  allKindsVisible,
  barKinds,
  barLayers,
  groupState,
  groupsFor,
  kindVisible,
  type Source,
} from "../lib/visual/layerGroups";
import type { LaneRef } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { PREF_KEYS, type PrefKey } from "./prefKeys";
import {
  isBoolean,
  isBooleanRecord,
  isFiniteNumber,
  isStringArray,
  prefField,
  readPref,
  writePref,
} from "./prefs";

/**
 * What a right-click landed on; `space` carries the world point the pointer was over. `body` and
 * `systemSpace` are inside the system scene of `system`, where `systemSpace`'s point is in that
 * scene's own coordinates.
 */
export type ContextTarget =
  | { kind: "system"; id: number }
  | { kind: "lane"; lane: LaneRef }
  /** A pair the scenario keeps from a lane, drawn as a dashed line. */
  | { kind: "prevented"; a: number; b: number }
  | { kind: "nebula"; index: number }
  /** A fallen empire zone's ring, named by the system that anchors it. */
  | { kind: "feZone"; anchor: number }
  | { kind: "space"; x: number; y: number }
  | { kind: "body"; system: number; id: number }
  /** A belt of the system view, right-clicked on one of its handles. */
  | { kind: "belt"; system: number; index: number }
  /** A megastructure of the system view, right-clicked on its model. */
  | { kind: "megastructure"; system: number; id: number }
  | { kind: "systemSpace"; system: number; x: number; y: number }
  /** A body's row in an inspector list, on the galaxy or in any system's view. */
  | { kind: "bodyRow"; system: number; id: number };

/** A context menu for a system, a lane or empty space, anchored in map-area pixels. */
export interface ContextMenu {
  target: ContextTarget;
  x: number;
  y: number;
  /** The galaxy map's world point under the right-click; absent for a menu opened elsewhere. */
  at?: Pt;
}

/** Tooltip text: plain, or pieces with inline icons named by texture key. */
export type MapTooltipText = string | Array<string | { icon: string }>;

/**
 * A plain line, a label/value row, a group heading (its value totals the rows under it), or an
 * indented member row. `stacked` breaks the value onto its own line below the label, for rows
 * whose value is prose long enough to wrap (a planet's class, size and colony status).
 */
export type MapTooltipLine =
  | string
  | { label: MapTooltipText; value: MapTooltipText; indent?: boolean; stacked?: boolean }
  | { heading: string; value?: string };

/**
 * What the map draws while the menu on empty space offers to add a system there: the game's spawn
 * buffer around the point, and how far out a system may stand when the point is past it.
 */
export interface AddSystemPreview {
  x: number;
  y: number;
  /** Another system is inside the buffer. */
  tooClose: boolean;
  /** How far from the centre a system may stand, set only when the point is past it. */
  edge: number | null;
}

/** What the pointer is doing on the map, where the status bar's hint differs from the idle one. */
export type MapGesture = "lane" | "connecting";

/** A hover tooltip over the map, anchored in map-area pixels. */
export interface MapTooltip {
  x: number;
  y: number;
  title: string;
  lines: MapTooltipLine[];
  /** Drawn as a warning, for a readout that says something is wrong. */
  tone?: "warn";
}

export interface MapChromeState {
  layers: GalaxyLayers;
  /** What the system scene draws of the layers it shares with the galaxy, switched apart from it. */
  sceneLayers: Record<SceneLayerId, boolean>;
  /** The point-of-interest kinds the map draws; each kind is its own layer. */
  shownKinds: Set<SpecialKind>;
  /** Initializer keys the legend has filtered out; their systems are dimmed and unlabelled. */
  hiddenInitializers: Set<string>;
  /** Precursor keys the legend has filtered out; `NO_PRECURSOR` hides the grey "no precursor" mark. */
  hiddenPrecursors: Set<string>;
  contextMenu: ContextMenu | null;
  tooltip: MapTooltip | null;
  /** The Lane density slider's value in [0, 1], shared by the brushes, shapes and the mesh action. */
  laneDensity: number;
  /** Whether the lanes the brushes and the mesh action add are grouped into islands as the game does. */
  laneIslands: boolean;
  addSystemPreview: AddSystemPreview | null;
  /** Lanes the map draws as ghosts while the mesh action is being considered. */
  lanePreview: Array<[number, number]> | null;
  /** Initializer key the initializer browser is highlighting; its systems are ringed on the map. */
  highlightInitializer: string | null;
  /** A lane under the pointer, or a lane being dragged out of a system's ring; null otherwise. */
  gesture: MapGesture | null;
  /** What the system scene says in the status bar while it shows, such as a clicked lane's length. */
  sceneHint: string | null;
  toggleLayer(id: GalaxyLayerId): void;
  toggleSceneLayer(id: SceneLayerId): void;
  /** Shows or hides one point-of-interest kind. */
  toggleKind(kind: SpecialKind): void;
  /** Shows every point-of-interest kind, or hides them all when they are all shown. */
  toggleAllKinds(): void;
  /** Shows or hides every system whose initializer is `key`. */
  toggleInitializer(key: string): void;
  /** Shows or hides every system whose precursor (or lack of one) is `key`. */
  togglePrecursor(key: string): void;
  /** Hides every key in `keys`, or shows them all once every one of them is hidden. */
  toggleInitializers(keys: Iterable<string>): void;
  showAllInitializers(): void;
  /** Hides every initializer key `keys` lists, which is the whole legend. */
  hideAllInitializers(keys: Iterable<string>): void;
  /** Toggles what the number key at `index` (0-based) is bound to. */
  toggleLayerKey(index: number): void;
  /** Puts the layers the user has not set by hand onto what a document of `kind` opens with. */
  openedAs(kind: DocumentKind): void;
  /** Puts every layer and kind back to what the open document starts with. */
  resetLayers(): void;
  /** Turns every layer one source decides off, or on once any of them is off. */
  toggleGroup(source: Source): void;
  openContextMenu(menu: ContextMenu): void;
  closeContextMenu(): void;
  showTooltip(tip: MapTooltip): void;
  hideTooltip(): void;
  setLaneDensity(density: number): void;
  setLaneIslands(on: boolean): void;
  /**
   * Sets a layer without persisting it: for state the app borrows rather than the user sets, or
   * an edit the user must be able to see.
   */
  setLayerQuietly(id: GalaxyLayerId, on: boolean): void;
  setLanePreview(pairs: Array<[number, number]> | null): void;
  setAddSystemPreview(preview: AddSystemPreview | null): void;
  setHighlightInitializer(key: string | null): void;
  setGesture(gesture: MapGesture | null): void;
  setSceneHint(text: string | null): void;
  /** Drops what only makes sense over the save that was open: menu, tooltip, ghosts and filter. */
  clearOverlays(): void;
}

/** The kinds the points-of-interest layer draws on a fresh profile; the rest start hidden. */
const DEFAULT_SHOWN_KINDS: SpecialKind[] = ["leviathan", "enclave"];

const NO_OVERLAYS = {
  contextMenu: null,
  tooltip: null,
  lanePreview: null,
  addSystemPreview: null,
  highlightInitializer: null,
  gesture: null,
  sceneHint: null,
  // The keys belong to the document that was open, so the filter goes with it.
  hiddenInitializers: new Set<string>(),
} satisfies Partial<MapChromeState>;

const LANE_DENSITY_PREF = prefField(PREF_KEYS.laneDensity, DEFAULT_LANE_DENSITY, isFiniteNumber);
const LANE_ISLANDS_PREF = prefField(PREF_KEYS.laneIslands, false, isBoolean);

/** The stored density, or the one whose cut is a β the slider stored before it kept a density. */
function storedLaneDensity(): number {
  const beta = readPref<number | null>(PREF_KEYS.meshBeta, null, isFiniteNumber);
  return LANE_DENSITY_PREF.read(beta === null || beta <= 0 ? undefined : densityOfBeta(beta));
}

/**
 * `changed` with the layers it drags along: the day-one claims draw only inside the empire
 * borders, so they come on with them and go with them; the borders themselves are drawn either way.
 */
function coupled(changed: Partial<GalaxyLayers>): Partial<GalaxyLayers> {
  const out = { ...changed };
  if (changed.claims === true) out.owners = true;
  if (changed.owners === false) out.claims = false;
  return out;
}

/** A stored kind list, keeping the kinds this build still has: one it has dropped is forgotten. */
function storedKinds(key: PrefKey): SpecialKind[] | null {
  const stored = readPref<string[] | null>(key, null, isStringArray);
  return stored === null ? null : KIND_ORDER.filter((kind) => stored.includes(kind));
}

/** The shown kinds this profile last had. */
function storedShownKinds(): SpecialKind[] {
  return storedKinds(PREF_KEYS.shownKinds) ?? DEFAULT_SHOWN_KINDS;
}

/** A stored layer state over `base`, keeping only this build's layers and defaulting the rest. */
function storedLayers(base: GalaxyLayers): GalaxyLayers {
  return storedSwitches(PREF_KEYS.layers, base, GALAXY_LAYER_IDS);
}

/** The system scene's stored switches over its defaults. */
function storedSceneLayers(): Record<SceneLayerId, boolean> {
  return storedSwitches(PREF_KEYS.sceneLayers, DEFAULT_SCENE_LAYERS, SCENE_LAYER_IDS);
}

/** The switches stored under `key` over `base`, keeping only `ids` and defaulting the rest. */
function storedSwitches<Id extends string>(
  key: PrefKey,
  base: Readonly<Record<Id, boolean>>,
  ids: readonly Id[],
): Record<Id, boolean> {
  const stored = readPref<Record<string, boolean> | null>(key, null, isBooleanRecord);
  const switches: Record<Id, boolean> = { ...base };
  if (stored === null) return switches;
  for (const id of ids) if (stored[id] !== undefined) switches[id] = stored[id];
  return switches;
}

/** Every kind there is, in the order the open document counts them in. */
function allKinds(): SpecialKind[] {
  return kindOrder(useGameDataStore.getState().counts);
}

function rememberKinds(kinds: Set<SpecialKind>): void {
  writePref(PREF_KEYS.shownKinds, [...kinds]);
}

/** Writes the keys the user's press decided over the record the profile already holds. */
function rememberLayers(changed: Partial<GalaxyLayers>): void {
  const stored = readPref<Record<string, boolean> | null>(PREF_KEYS.layers, null, isBooleanRecord);
  writePref(PREF_KEYS.layers, { ...stored, ...changed });
}

/** The group one "all" button switches, or undefined where the open document has no such group. */
function switchableGroup(source: Source) {
  const kind = useFileSessionStore.getState().kind;
  return groupsFor(kind).find((group) => group.master && group.source === source);
}

export const useMapChromeStore = create<MapChromeState>((set, get) => ({
  ...NO_OVERLAYS,
  layers: storedLayers(DEFAULT_LAYERS),
  sceneLayers: storedSceneLayers(),
  shownKinds: new Set<SpecialKind>(storedShownKinds()),
  hiddenPrecursors: new Set<string>(),
  laneDensity: storedLaneDensity(),
  laneIslands: LANE_ISLANDS_PREF.read(),

  toggleLayer(id) {
    const changed = coupled({ [id]: !get().layers[id] });
    set({ layers: { ...get().layers, ...changed } });
    rememberLayers(changed);
  },

  toggleSceneLayer(id) {
    const sceneLayers = { ...get().sceneLayers, [id]: !get().sceneLayers[id] };
    set({ sceneLayers });
    writePref(PREF_KEYS.sceneLayers, sceneLayers);
  },

  toggleKind(kind) {
    const shownKinds = new Set(get().shownKinds);
    if (kindVisible(get(), kind)) shownKinds.delete(kind);
    else {
      shownKinds.add(kind);
      get().setLayerQuietly("special", true);
    }
    set({ shownKinds });
    rememberKinds(shownKinds);
  },

  toggleInitializer(key) {
    const hiddenInitializers = new Set(get().hiddenInitializers);
    if (hiddenInitializers.has(key)) hiddenInitializers.delete(key);
    else hiddenInitializers.add(key);
    set({ hiddenInitializers });
  },

  togglePrecursor(key) {
    const hiddenPrecursors = new Set(get().hiddenPrecursors);
    if (hiddenPrecursors.has(key)) hiddenPrecursors.delete(key);
    else hiddenPrecursors.add(key);
    set({ hiddenPrecursors });
  },

  toggleInitializers(keys) {
    const list = [...keys];
    const hiddenInitializers = new Set(get().hiddenInitializers);
    const hideThem = !list.every((key) => hiddenInitializers.has(key));
    for (const key of list) {
      if (hideThem) hiddenInitializers.add(key);
      else hiddenInitializers.delete(key);
    }
    set({ hiddenInitializers });
  },

  showAllInitializers() {
    if (get().hiddenInitializers.size > 0) set({ hiddenInitializers: new Set<string>() });
  },

  hideAllInitializers(keys) {
    set({ hiddenInitializers: new Set(keys) });
  },

  toggleAllKinds() {
    const all = allKindsVisible(get());
    const shownKinds = new Set<SpecialKind>(all ? [] : allKinds());
    if (!all) get().setLayerQuietly("special", true);
    set({ shownKinds });
    rememberKinds(shownKinds);
  },

  toggleLayerKey(index) {
    const layer = LAYER_KEYS[index];
    if (!layer) return;
    if (layer === "special") get().toggleAllKinds();
    else get().toggleLayer(layer);
  },

  openedAs(kind) {
    set({ layers: storedLayers(defaultLayers(kind)) });
  },

  resetLayers() {
    const kind = useFileSessionStore.getState().kind;
    const layers = kind === null ? { ...DEFAULT_LAYERS } : defaultLayers(kind);
    const shownKinds = new Set<SpecialKind>(DEFAULT_SHOWN_KINDS);
    set({
      layers,
      sceneLayers: { ...DEFAULT_SCENE_LAYERS },
      shownKinds,
      hiddenInitializers: new Set<string>(),
      hiddenPrecursors: new Set<string>(),
    });
    rememberKinds(shownKinds);
    writePref(PREF_KEYS.layers, {});
    writePref(PREF_KEYS.sceneLayers, {});
  },

  toggleGroup(source) {
    const kind = useFileSessionStore.getState().kind;
    const group = switchableGroup(source);
    if (!group) return;
    // Anything of the group still drawn means the press hides it all; only an empty group fills.
    const hide = groupState(get(), kind, source) !== "off";
    const ids = barLayers(group);
    const kinds = barKinds(group);
    const changed = coupled(Object.fromEntries(ids.map((id) => [id, !hide])));
    const layers = { ...get().layers, ...changed };
    // The bar's kind buttons switch with the group; the kinds only the menu lists stay as they are.
    const shownKinds = new Set(get().shownKinds);
    for (const k of kinds) {
      if (hide) shownKinds.delete(k);
      else shownKinds.add(k);
    }
    if (!hide && kinds.length > 0) layers.special = true;
    set({ layers, shownKinds });
    rememberLayers(changed);
    if (kinds.length > 0) rememberKinds(shownKinds);
  },

  openContextMenu(menu) {
    set({ contextMenu: menu, addSystemPreview: null });
  },

  closeContextMenu() {
    if (get().contextMenu || get().addSystemPreview) {
      set({ contextMenu: null, addSystemPreview: null });
    }
  },

  showTooltip(tip) {
    set({ tooltip: tip });
  },

  hideTooltip() {
    if (get().tooltip) set({ tooltip: null });
  },

  setLaneDensity(density) {
    set({ laneDensity: density });
    LANE_DENSITY_PREF.save(density);
  },

  setLaneIslands(laneIslands) {
    set({ laneIslands });
    LANE_ISLANDS_PREF.save(laneIslands);
  },

  setLayerQuietly(id, on) {
    if (get().layers[id] === on) return;
    set({ layers: { ...get().layers, [id]: on } });
  },

  setLanePreview(pairs) {
    set({ lanePreview: pairs });
  },

  setAddSystemPreview(preview) {
    set({ addSystemPreview: preview });
  },

  setHighlightInitializer(key) {
    set({ highlightInitializer: key });
  },

  setGesture(gesture) {
    if (get().gesture !== gesture) set({ gesture });
  },

  setSceneHint(text) {
    if (get().sceneHint !== text) set({ sceneHint: text });
  },

  clearOverlays() {
    set({ ...NO_OVERLAYS });
  },
}));
