import { confirm } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { FeDirection } from "../generated/FeDirection";
import type { FeZone } from "../generated/FeZone";
import type { HistoryView } from "../generated/HistoryView";
import type { Op } from "../generated/Op";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemDetail } from "../generated/SystemDetail";
import type { SystemNode } from "../generated/SystemNode";
import { documentCapabilities, supports } from "../lib/capabilities";
import {
  feZoneBlocked,
  feZoneCentre,
  feZoneRefusal,
  firstFreeDirection,
  newFeZone,
  NO_FREE_DIRECTION,
  snapFeZone,
} from "../lib/feZone";
import {
  ALL_CLANS_PLACED,
  BASES_NEED_LANES,
  baseInitializer,
  basesBeside,
  baseSite,
  clanHomes,
  clanInUse,
  clanSystems,
  homeInitializer,
  missingBaseSites,
  nextFreeClan,
  placeBases,
} from "../lib/marauder";
import { enabledScript, nextWormholePair, sharedWormholePair } from "../lib/paint";
import {
  linkedPairs,
  linkedSystems,
  linkedTo,
  meshLanes,
  staleLaneCount,
  unlinkedPairs,
  unlinkedTo,
  useGalaxyStore,
} from "./galaxyStore";
import { useDetailsStore } from "./detailsStore";
import { useEntityStore } from "./entityStore";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore, type EntityRef } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useScriptsStore } from "./scriptsStore";
import { PREF_KEYS } from "./prefKeys";
import { isFiniteNumber, readPref, writePref } from "./prefs";

export type { MapTooltip, MapTooltipLine, MapTooltipText } from "./mapChromeStore";

export interface Focus {
  id: number;
  nonce: number;
}

/** A world point the map eases to; the nonce repeats a pan to the same place. */
export interface Pan {
  x: number;
  y: number;
  nonce: number;
}

/** How many search hits the palette offers again on an empty query. */
export const RECENT_HITS = 8;

/** An undirected lane by its endpoints, `a < b`. */
export interface LaneRef {
  a: number;
  b: number;
}

export type SelectionMode = "replace" | "add";

/** Above this many selected systems "connect to each other" gives way to the mesh. */
export const CONNECT_ALL_MAX = 5;

/** The radius a new nebula gets on a profile that has never made one. */
export const DEFAULT_NEBULA_RADIUS = 30;

export interface EditorState {
  /** Selected system ids in selection order, no duplicates; at most one of a non-empty `selection`, `selectedLane` and `selectedNebula` is set. */
  selection: number[];
  selectedLane: LaneRef | null;
  /** The selected nebula's file-order index, which is the only name a nebula has. */
  selectedNebula: number | null;
  hover: number | null;
  /** The system the inspector reads, fetched only while exactly one system is selected. */
  inspected: SystemDetail | null;
  /** Set by jumpTo; the map eases to the system whenever the nonce changes. */
  focus: Focus | null;
  /** Set by panTo; the map eases to the point whenever the nonce changes, keeping its zoom. */
  pan: Pan | null;
  /** The search hits taken this session, most recent first; the palette shows them on an empty query. */
  recentHits: SearchHit[];
  /** Bumped by requestFit; the map re-fits the galaxy whenever it changes. */
  fitNonce: number;
  /** Bumped by fitSelection; the map eases to the selected systems whenever it changes. */
  fitSelectionNonce: number;
  history: HistoryView;
  /** The radius `addNebulaAt` reaches for, kept across sessions on this machine. */
  lastNebulaRadius: number;
  /** The world point a new nebula is being named for, null while none is being created. */
  nebulaPrompt: { x: number; y: number } | null;
  /** What the fit dialog is asked over: the mod's candidate rings and the automatic zones standing now. */
  feZoneFitPrompt: { candidates: number; automatic: number } | null;

  /** Replaces the selection with `id`, or clears it. */
  select(id: number | null): Promise<void>;
  /** What Esc does: nothing selected, no lane, and the dock back on the tab the selection interrupted. */
  clearSelection(): Promise<void>;
  /** Adds `id` to the selection, or removes it when already selected. */
  toggleSelect(id: number): Promise<void>;
  /** Replaces the selection with `ids`, or unions them into it in order. */
  setSelection(ids: number[], mode: SelectionMode): Promise<void>;
  selectAll(): Promise<void>;
  selectLane(lane: LaneRef | null): void;
  /** Selects the nebula at `index` (file order), or clears the nebula selection. */
  selectNebula(index: number | null): void;
  jumpTo(id: number): Promise<void>;
  /** Eases the map to a world point without changing the selection. */
  panTo(x: number, y: number): void;
  /** Remembers a hit the search palette went to. */
  noteSearchHit(hit: SearchHit): void;
  setHover(id: number | null): void;
  requestFit(): void;
  /** Frames the selected systems, or the whole galaxy when nothing is selected. */
  fitSelection(): void;
  /** Cuts the selected lane or removes the selected nebula, whichever is selected. */
  deleteSelection(): Promise<void>;
  /** Moves every selected system by a world offset in one op. */
  nudgeSelection(dx: number, dy: number): Promise<void>;
  /** Moves the nebula at `index` (file order) to a world position together with its member systems. */
  moveNebula(index: number, x: number, y: number): Promise<void>;
  /** Adds a nebula at a world point, remembers its radius and selects it. */
  addNebulaAt(x: number, y: number, radius?: number, name?: string | null): Promise<boolean>;
  /** Asks for the name a new nebula at a world point is to carry; nothing is created yet. */
  promptNebulaAt(x: number, y: number): void;
  cancelNebulaPrompt(): void;
  /** Creates the nebula the prompt is waiting on. A blank name creates nothing. */
  createPromptedNebula(name: string): Promise<boolean>;
  /** Resizes the nebula at `index` about its centre; the members follow. */
  setNebulaRadius(index: number, radius: number): Promise<void>;
  /** Renames the nebula at `index`; the text is written as the file's own literal. */
  setNebulaName(index: number, name: string): Promise<void>;
  /** Removes the nebula at `index`, renumbering the ones after it, and deselects. */
  removeNebula(index: number): Promise<void>;
  /** Adds a system at a world point, with the initializer it spawns from, and selects it. */
  addSystemAt(
    x: number,
    y: number,
    initializer?: string | null,
    spawnWeight?: number | null,
  ): Promise<boolean>;
  /** Adds the next free marauder clan at a world point: its home there, two raid bases beside it. */
  addMarauderClanAt(point: { x: number; y: number }): Promise<boolean>;
  /** Makes `home` and the two `bases` hyperlaned to it the next free marauder clan, in one op. */
  makeMarauderClan(home: number, bases: [number, number]): Promise<boolean>;
  /** Sets every system of clan `clan` back to random, in one op. */
  removeMarauderClan(clan: number): Promise<boolean>;
  /** Adds the raid bases `home` is missing beside it, each hyperlaned to it. */
  addMarauderBases(home: number): Promise<boolean>;
  /** Renumbers the clan `home` heads, its bases with it, in one op; refused when `to` is in use. */
  renumberMarauderClan(home: number, to: number): Promise<boolean>;
  /** Removes a system and every lane touching it, once the user has confirmed. */
  removeSystem(id: number): Promise<void>;
  /** Writes the fallen empire zone `id` anchors, or removes it with null. */
  setFeZone(id: number, zone: FeZone | null): Promise<boolean>;
  /** Gives `id` a zone in the first clear direction at the default distance, and selects it. */
  addFeZone(id: number): Promise<boolean>;
  /** Anchors a zone on the system nearest a world point, its ring snapped to the point. */
  addFeZoneAt(point: { x: number; y: number }): Promise<boolean>;
  /** Moves the ring `id` anchors, keeping its kind; the zone becomes the user's own. */
  moveFeZone(id: number, direction: FeDirection, distance: number): Promise<boolean>;
  /** Asks how many automatic zones to fit; nothing is written yet. */
  promptFeZoneFit(): Promise<void>;
  cancelFeZoneFit(): void;
  /** Replaces the automatic zones with `count` of the mod's candidates, spread across the map. */
  fitFeZones(count: number): Promise<void>;
  /** Writes the empire-count header keys the mod's formulas give the scenario's seats. */
  updateEmpireCounts(): Promise<void>;
  /** Makes `a` and `b` the two ends of a new wormhole pair, numbered past every pair in use. */
  linkWormholePair(a: number, b: number): Promise<boolean>;
  /** Takes the pair `a` and `b` share away from both; nothing when they share none. */
  unlinkWormholePair(a: number, b: number): Promise<boolean>;
  /** Adds a lane between every unlinked pair of selected systems, up to `CONNECT_ALL_MAX` of them. */
  connectSelected(): Promise<void>;
  /** Adds the missing lanes of the β-skeleton over the selected systems at the chrome's `meshBeta`. */
  connectSelectedMesh(): Promise<void>;
  /** Adds a lane from `target` to every selected system not yet linked to it. */
  connectSelectedTo(target: number): Promise<void>;
  /** Cuts every lane between two selected systems. */
  cutLanesBetweenSelected(): Promise<void>;
  /** Cuts every lane between `target` and a selected system. */
  cutLanesToSelected(target: number): Promise<void>;
  /** Cuts every lane of every selected system. */
  isolateSelected(): Promise<void>;
  /** Sets every lane touching a selected system to `floor(distance)` where it differs. */
  resetSelectedLaneLengths(): Promise<void>;
  /**
   * Resolves true when the edit applied; a refused op sets the session error and resolves false.
   * A reclassification a later edit takes over may still be settling when it resolves.
   */
  applyOp(op: Op): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Undoes until the entry with `seq` is the last applied one. */
  undoTo(seq: number): Promise<void>;
  /** Redoes until the entry with `seq` is the last applied one. */
  redoTo(seq: number): Promise<void>;
  /** Forgets everything that belonged to the file that was open. */
  resetSession(): void;
}

const INITIAL = {
  selection: [] as number[],
  selectedLane: null as LaneRef | null,
  selectedNebula: null as number | null,
  hover: null as number | null,
  inspected: null as SystemDetail | null,
  focus: null as Focus | null,
  pan: null as Pan | null,
  recentHits: [] as SearchHit[],
  history: { undo: [], redo: [] } as HistoryView,
  nebulaPrompt: null as { x: number; y: number } | null,
  feZoneFitPrompt: null as { candidates: number; automatic: number } | null,
} satisfies Partial<EditorState>;

export const useEditorStore = create<EditorState>((set, get) => ({
  ...INITIAL,
  fitNonce: 0,
  fitSelectionNonce: 0,
  lastNebulaRadius: readPref(PREF_KEYS.nebulaRadius, DEFAULT_NEBULA_RADIUS, isFiniteNumber),

  async select(id) {
    await selectSystems(id === null ? [] : [id]);
  },

  async clearSelection() {
    await get().select(null);
    get().selectLane(null);
    useLayoutStore.getState().restoreTab();
  },

  async toggleSelect(id) {
    const { selection } = get();
    await selectSystems(
      selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id],
    );
  },

  async setSelection(ids, mode) {
    await selectSystems(unique(mode === "add" ? [...get().selection, ...ids] : ids));
  },

  async selectAll() {
    await selectSystems([...useGalaxyStore.getState().systems.keys()]);
  },

  async jumpTo(id) {
    const nonce = (get().focus?.nonce ?? 0) + 1;
    set({ focus: { id, nonce } });
    await get().select(id);
  },

  panTo(x, y) {
    set({ pan: { x, y, nonce: (get().pan?.nonce ?? 0) + 1 } });
  },

  noteSearchHit(hit) {
    const rest = get().recentHits.filter((h) => h.kind !== hit.kind || h.id !== hit.id);
    set({ recentHits: [hit, ...rest].slice(0, RECENT_HITS) });
  },

  selectLane(lane) {
    set({ selectedLane: lane, selection: [], selectedNebula: null, inspected: null });
  },

  selectNebula(index) {
    set({ selectedNebula: index, selection: [], selectedLane: null, inspected: null });
    if (index !== null) useLayoutStore.getState().revealInspector();
  },

  setHover(id) {
    if (get().hover !== id) set({ hover: id });
  },

  requestFit() {
    set({ fitNonce: get().fitNonce + 1 });
  },

  fitSelection() {
    set({ fitSelectionNonce: get().fitSelectionNonce + 1 });
  },

  async deleteSelection() {
    const { selectedLane: lane, selectedNebula } = get();
    if (selectedNebula !== null) {
      await get().removeNebula(selectedNebula);
      return;
    }
    if (!lane) return;
    if (await get().applyOp({ type: "RemoveLane", a: lane.a, b: lane.b })) {
      set({ selectedLane: null });
    }
  },

  async nudgeSelection(dx, dy) {
    const moves = get().selection.flatMap((id) => {
      const s = systems().get(id);
      return s ? [{ id, x: s.x + dx, y: s.y + dy }] : [];
    });
    if (moves.length === 0) return;
    await get().applyOp(
      moves.length === 1 ? { type: "MoveSystem", ...moves[0] } : { type: "MoveSystems", moves },
    );
  },

  async moveNebula(index, x, y) {
    await get().applyOp({ type: "MoveNebula", index, x, y });
  },

  async addNebulaAt(x, y, radius = get().lastNebulaRadius, name = null) {
    if (!(await get().applyOp({ type: "AddNebula", x, y, radius, name }))) return false;
    set({ lastNebulaRadius: radius });
    writePref(PREF_KEYS.nebulaRadius, radius);
    // A cloud nobody can see is a cloud nobody can edit.
    useMapChromeStore.getState().showLayer("nebulae");
    // A new nebula always lands last, so it is the last of the list the op left behind.
    get().selectNebula(useGalaxyStore.getState().nebulae.length - 1);
    return true;
  },

  promptNebulaAt(x, y) {
    set({ nebulaPrompt: { x, y } });
  },

  cancelNebulaPrompt() {
    if (get().nebulaPrompt) set({ nebulaPrompt: null });
  },

  async createPromptedNebula(name) {
    const at = get().nebulaPrompt;
    const named = name.trim();
    // The label is the handle the cloud is dragged by, so it is named before it exists.
    if (!at || named === "") return false;
    // A refused op leaves the prompt standing with the point and the name still in it.
    if (!(await get().addNebulaAt(at.x, at.y, undefined, named))) return false;
    set({ nebulaPrompt: null });
    return true;
  },

  async setNebulaRadius(index, radius) {
    await get().applyOp({ type: "SetNebulaRadius", index, radius });
  },

  async setNebulaName(index, name) {
    await get().applyOp({ type: "SetNebulaName", index, name });
  },

  async removeNebula(index) {
    // Removing renumbers everything after `index`, so no selection survives it.
    if (await get().applyOp({ type: "RemoveNebula", index })) set({ selectedNebula: null });
  },

  async addSystemAt(x, y, initializer = null, spawnWeight = null) {
    // Under the Paint a Galaxy profile the weight is the site's script, written once the id is known.
    const paint = getPaintLayer() && spawnWeight !== null;
    const op: Op = {
      type: "AddSystem",
      id: null,
      x,
      y,
      name: null,
      initializer,
      spawn_weight: paint ? null : spawnWeight,
    };
    if (!(await get().applyOp(op))) return false;
    const [added] = lastEdited;
    if (!added) return true;
    if (paint) {
      const script: Op = { type: "SetSpawnScript", id: added.id, script: enabledScript(added) };
      if (!(await get().applyOp(script))) return false;
    }
    await get().select(added.id);
    return true;
  },

  async addMarauderClanAt(point) {
    const clan = nextFreeClan(systems());
    if (clan === null) {
      useFileSessionStore.getState().setError(ALL_CLANS_PLACED);
      return false;
    }
    const home = await addSystem(point, homeInitializer(clan));
    if (home === null) return false;
    if (!(await get().addMarauderBases(home))) return false;
    useMapChromeStore.getState().showLayer("marauders");
    await get().select(home);
    return true;
  },

  async makeMarauderClan(home, bases) {
    const clan = nextFreeClan(systems());
    if (clan === null) {
      useFileSessionStore.getState().setError(ALL_CLANS_PLACED);
      return false;
    }
    const lanes = systems().get(home)?.lanes ?? [];
    if (!bases.every((base) => lanes.some((lane) => lane.to === base))) {
      useFileSessionStore.getState().setError(BASES_NEED_LANES);
      return false;
    }
    const [second, third] = [...bases].sort((a, b) => a - b);
    const op: Op = {
      type: "SetInitializers",
      entries: [
        { id: home, initializer: homeInitializer(clan) },
        { id: second, initializer: baseInitializer(clan, 2) },
        { id: third, initializer: baseInitializer(clan, 3) },
      ],
    };
    if (!(await get().applyOp(op))) return false;
    useMapChromeStore.getState().showLayer("marauders");
    return true;
  },

  async removeMarauderClan(clan) {
    const entries = clanSystems(clan, systems()).map((id) => ({ id, initializer: null }));
    if (entries.length === 0) return false;
    return get().applyOp({ type: "SetInitializers", entries });
  },

  async renumberMarauderClan(home, to) {
    const system = systems().get(home);
    if (!system?.marauder || !("home" in system.marauder)) return false;
    if ((clanHomes(systems()).get(to) ?? []).some((id) => id !== home)) {
      useFileSessionStore.getState().setError(clanInUse(to));
      return false;
    }
    const entries = [
      { id: home, initializer: homeInitializer(to) },
      ...basesBeside(system, systems()).map((base) => ({
        id: base.id,
        initializer: baseInitializer(to, baseSite(base)),
      })),
    ];
    return get().applyOp({ type: "SetInitializers", entries });
  },

  async addMarauderBases(home) {
    const system = systems().get(home);
    if (!system?.marauder || !("home" in system.marauder)) return false;
    const clan = system.marauder.home;
    const added: number[] = [];
    for (const site of placeBases(
      system,
      missingBaseSites(system, systems()),
      systems().values(),
    )) {
      const id = await addSystem(site, baseInitializer(clan, site.site));
      if (id === null) return false;
      added.push(id);
    }
    if (added.length === 0) return true;
    const lanes: Op = { type: "AddLanes", from: home, to: added.map((id) => [id, false]) };
    return get().applyOp(lanes);
  },

  async removeSystem(id) {
    const system = systems().get(id);
    if (!system) return;
    const name = useGalaxyStore.getState().systemName(id);
    const lanes = system.lanes.length;
    const what = lanes === 0 ? name : `${name} and its ${lanes} lane${lanes === 1 ? "" : "s"}`;
    if (!(await confirm(`Delete ${what}?`, { title: name, kind: "warning" }))) return;
    await get().applyOp({ type: "RemoveSystem", id });
  },

  async setFeZone(id, zone) {
    return get().applyOp({ type: "SetFeZone", id, zone });
  },

  async addFeZone(id) {
    const anchor = systems().get(id);
    if (!anchor) return false;
    const direction = firstFreeDirection(anchor, systems());
    if (direction === null) {
      useFileSessionStore.getState().setError(NO_FREE_DIRECTION);
      return false;
    }
    return placeFeZone(id, newFeZone(direction));
  },

  async addFeZoneAt(point) {
    const anchor = nearestSystem(point);
    if (!anchor) {
      useFileSessionStore.getState().setError(NEEDS_A_SYSTEM);
      return false;
    }
    const snapped = snapFeZone(anchor, point);
    const blocked = feZoneBlocked(feZoneCentre(anchor, snapped), systems(), anchor.id);
    if (blocked !== null) {
      const name = useGalaxyStore.getState().systemName;
      useFileSessionStore.getState().setError(feZoneRefusal(blocked, (s) => name(s.id)));
      return false;
    }
    const zone = anchor.fe_zone ?? newFeZone(snapped.direction, snapped.distance);
    return placeFeZone(anchor.id, { ...zone, ...snapped, preferred: true });
  },

  async moveFeZone(id, direction, distance) {
    const zone = systems().get(id)?.fe_zone;
    if (!zone) return false;
    return get().setFeZone(id, { ...zone, direction, distance, preferred: true });
  },

  async promptFeZoneFit() {
    let candidates: number;
    try {
      candidates = await ipc.feZoneCandidateCount();
    } catch (e) {
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      return;
    }
    let automatic = 0;
    for (const system of systems().values()) {
      if (system.fe_zone !== null && !system.fe_zone.preferred) automatic += 1;
    }
    set({ feZoneFitPrompt: { candidates, automatic } });
  },

  cancelFeZoneFit() {
    if (get().feZoneFitPrompt) set({ feZoneFitPrompt: null });
  },

  async fitFeZones(count) {
    set({ feZoneFitPrompt: null });
    let entries: Array<[number, FeZone | null]>;
    try {
      entries = await ipc.feZoneFit(count);
    } catch (e) {
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      return;
    }
    if (entries.length === 0) {
      useFileSessionStore.getState().setError(NOTHING_TO_FIT);
      return;
    }
    if (await get().applyOp({ type: "SetFeZones", entries })) {
      useMapChromeStore.getState().showLayer("feZones");
    }
  },

  async updateEmpireCounts() {
    let entries: Array<[string, string]>;
    try {
      entries = await ipc.headerEmpireCounts();
    } catch (e) {
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      return;
    }
    await get().applyOp({ type: "SetHeaderKeys", entries });
  },

  async linkWormholePair(a, b) {
    const pair = nextWormholePair(systems().values());
    const linked = await get().applyOp({ type: "SetWormholePair", a, b, pair });
    if (linked) useMapChromeStore.getState().showLayer("day_one_bypasses");
    return linked;
  },

  async unlinkWormholePair(a, b) {
    if (sharedWormholePair(systems(), a, b) === null) return false;
    return get().applyOp({ type: "SetWormholePair", a, b, pair: null });
  },

  async connectSelected() {
    const { selection } = get();
    if (selection.length > CONNECT_ALL_MAX) return;
    const lanes = unlinkedPairs(systems(), selection).map(([a, b]) => ({ a, b, bridge: false }));
    if (lanes.length > 0) await get().applyOp({ type: "AddLanePairs", lanes });
  },

  async connectSelectedMesh() {
    const chrome = useMapChromeStore.getState();
    const lanes = meshLanes(systems(), get().selection, chrome.meshBeta).map(([a, b]) => ({
      a,
      b,
      bridge: false,
    }));
    if (lanes.length > 0) await get().applyOp({ type: "AddLanePairs", lanes });
    chrome.setLanePreview(null);
  },

  async connectSelectedTo(target) {
    const to = unlinkedTo(systems(), target, get().selection).map((id): [number, boolean] => [
      id,
      false,
    ]);
    if (to.length > 0) await get().applyOp({ type: "AddLanes", from: target, to });
  },

  async cutLanesBetweenSelected() {
    const lanes = linkedPairs(systems(), get().selection);
    if (lanes.length > 0) await get().applyOp({ type: "RemoveLanePairs", lanes });
  },

  async cutLanesToSelected(target) {
    const to = linkedTo(systems(), target, get().selection);
    if (to.length > 0) await get().applyOp({ type: "RemoveLanes", from: target, to });
  },

  async isolateSelected() {
    const ids = linkedSystems(systems(), get().selection);
    if (ids.length > 0) await get().applyOp({ type: "IsolateSystems", ids });
  },

  async resetSelectedLaneLengths() {
    if (!laneLengthsEditable()) return;
    const ids = get().selection;
    if (staleLaneCount(systems(), ids) > 0) {
      await get().applyOp({ type: "NormaliseLaneLengths", systems: ids });
    }
  },

  async applyOp(op) {
    const reclassifies = await enqueue(async () => {
      try {
        const result = await ipc.applyOp(op);
        applyEdit(result);
        return result.reclassifies;
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return null;
      }
    });
    if (reclassifies === null) return false;
    if (reclassifies) await reclassify();
    return true;
  },

  async undo() {
    if (await enqueue(() => stepEdit(ipc.undo))) await reclassify();
  },

  async redo() {
    if (await enqueue(() => stepEdit(ipc.redo))) await reclassify();
  },

  async undoTo(seq) {
    await stepHistory(ipc.undo, () => get().history.undo.length <= seq);
  },

  async redoTo(seq) {
    await stepHistory(ipc.redo, () => get().history.undo.length >= seq);
  },

  resetSession() {
    session += 1;
    set({ ...INITIAL });
  },
}));

/** The session a late answer still belongs to; a document closing or opening leaves it to nobody. */
let session = 0;

/** Adds one nameless system with `initializer` at a point, answering its id, or null when refused. */
async function addSystem(
  point: { x: number; y: number },
  initializer: string,
): Promise<number | null> {
  const op: Op = {
    type: "AddSystem",
    id: null,
    x: point.x,
    y: point.y,
    name: null,
    initializer,
    spawn_weight: null,
  };
  if (!(await useEditorStore.getState().applyOp(op))) return null;
  return lastEdited[0]?.id ?? null;
}

export const NEEDS_A_SYSTEM =
  "Add a system first. A fallen empire zone belongs to one of your systems.";

/** What the status bar says when a fit would change no zone. */
export const NOTHING_TO_FIT = "The automatic fallen empire zones already stand as asked.";

/** Writes a zone by hand, shows the rings, and selects the anchor so the inspector shows it. */
async function placeFeZone(id: number, zone: FeZone): Promise<boolean> {
  const editor = useEditorStore.getState();
  if (!(await editor.setFeZone(id, zone))) return false;

  useMapChromeStore.getState().showLayer("feZones");
  await editor.select(id);
  return true;
}

/** The system nearest a world point, wherever it is; null for a galaxy with none. */
export function nearestSystem(
  point: { x: number; y: number },
  among: Iterable<SystemNode> = systems().values(),
): SystemNode | null {
  let best: SystemNode | null = null;
  let bestD2 = Infinity;
  for (const s of among) {
    const d2 = (s.x - point.x) ** 2 + (s.y - point.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = s;
    }
  }
  return best;
}

let edits: Promise<unknown> = Promise.resolve();

/** Runs edits one at a time, so their results apply in the order they were asked for. */
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = edits.then(run, run);
  edits = next.catch(() => undefined);
  return next;
}

/** Applies one history step, answering whether it re-classifies; a step with nothing left to do leaves the session alone. */
async function stepEdit(step: () => Promise<EditResult | null>): Promise<boolean> {
  try {
    const result = await step();
    if (!result) return false;
    applyEdit(result);
    return result.reclassifies;
  } catch (e) {
    useFileSessionStore.getState().setError(ipc.errorMessage(e));
    return false;
  }
}

/** Repeats `step` until `done`, or until a step leaves the history unchanged; the run re-classifies once. */
async function stepHistory(
  step: () => Promise<EditResult | null>,
  done: () => boolean,
): Promise<void> {
  let reclassifies = false;
  while (!done()) {
    const before = useEditorStore.getState().history;
    if (await enqueue(() => stepEdit(step))) reclassifies = true;
    if (useEditorStore.getState().history === before) break;
  }
  if (reclassifies) await reclassify();
}

function systems() {
  return useGalaxyStore.getState().systems;
}

/** Whether the open document keeps the lane lengths the normalise op rewrites. */
function laneLengthsEditable(): boolean {
  return supports(documentCapabilities(useFileSessionStore.getState()), "lane_lengths");
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}

function isSingle(selection: number[], id: number): boolean {
  return selection.length === 1 && selection[0] === id;
}

/** The one path every selection change takes: it owns `inspected` and clears the lane and nebula. */
async function selectSystems(ids: number[], reveal = true): Promise<void> {
  const { setState, getState } = useEditorStore;
  setState({
    selection: ids,
    selectedLane: null,
    selectedNebula: null,
    inspected: ids.length === 1 ? getState().inspected : null,
  });
  if (ids.length !== 1) return;
  if (reveal) useLayoutStore.getState().revealInspector();
  const id = ids[0];
  try {
    const inspected = await ipc.getSystem(id);
    if (isSingle(getState().selection, id)) setState({ inspected });
  } catch (e) {
    if (isSingle(getState().selection, id)) {
      setState({ selection: [], inspected: null });
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
    }
  }
}

/** The reclassification that still counts; a later edit's takes it over. */
let reclassification = 0;

/** What an initializer change moves: how a system is classified, and who its scripts give it to. */
async function reclassify(): Promise<void> {
  const mine = ++reclassification;
  // It reads the whole galaxy, so it waits outside the queue and a run of edits reclassifies once.
  await edits;
  const alive = () => mine === reclassification;
  if (!alive()) return;
  const data = useGameDataStore.getState();
  await data.refreshSpecial(alive);
  if (!alive()) return;
  await data.refreshScenarioOwners(alive);
}

/** The systems the last edit re-projected, read before a reclassification writes its own delta. */
let lastEdited: readonly SystemNode[] = [];

function applyEdit(result: EditResult): void {
  lastEdited = result.delta.systems;
  useGalaxyStore.getState().applyDelta(result.delta);
  useFileSessionStore.getState().noteEdit({ issues: result.issues, dirty: result.dirty });
  useEditorStore.setState({ history: result.history });
  const touched = touchedSystems(result);
  useScriptsStore.getState().invalidate([...touched]);
  useEntityStore.getState().noteEdit(result);
  const { selection, selectedLane } = useEditorStore.getState();
  const kept = selection.filter((id) => systems().has(id));
  // Only a single selection re-reads anything; a lane or the galaxy follows galaxyStore's version.
  const stale =
    kept.length !== selection.length ||
    (kept.length === 1 && (touched.has(kept[0]) || showsTouched(touched, result.details_stale)));
  if (result.details_stale.length > 0) {
    useDetailsStore.getState().invalidate(result.details_stale);
    const mine = session;
    // The details projection, and the planet and fleet search index over it, are rebuilt lazily.
    void ipc.warmDetails().catch((e: unknown) => {
      if (mine === session) useFileSessionStore.getState().setError(ipc.errorMessage(e));
    });
  }
  if (stale) void selectSystems(kept, false);
  if (selectedLane && !laneExists(selectedLane)) useEditorStore.setState({ selectedLane: null });
  const { selectedNebula } = useEditorStore.getState();
  if (selectedNebula !== null && selectedNebula >= useGalaxyStore.getState().nebulae.length) {
    useEditorStore.setState({ selectedNebula: null });
  }
  const { hover } = useEditorStore.getState();
  if (hover !== null && !systems().has(hover)) useEditorStore.setState({ hover: null });
}

/** What an edit touched: the systems it re-projected and the details it staled. */
function touchedSystems(result: EditResult): Set<number> {
  const touched = new Set<number>(result.details_stale);
  for (const node of result.delta.systems) touched.add(node.id);
  return touched;
}

/** The entities the inspector reaches through a system's details. */
type DetailRef = Extract<EntityRef, { kind: "planet" | "fleet" | "megastructure" }>;

/** True when what the inspector is looking at lives in a system the edit touched. */
function showsTouched(touched: Set<number>, detailsStale: number[]): boolean {
  const { stack } = useInspectorStore.getState();
  const ref = stack[stack.length - 1].ref;
  switch (ref.kind) {
    case "system":
      return touched.has(ref.id);
    case "starbase":
      return touched.has(ref.system);
    case "lane":
      return touched.has(ref.a) || touched.has(ref.b);
    case "planet":
    case "fleet":
    case "megastructure": {
      const owner = owningSystem(ref);
      return owner === null ? detailsStale.length > 0 : detailsStale.includes(owner);
    }
    default:
      return false;
  }
}

/** The system whose cached details list `ref`, or null while they are not cached. */
function owningSystem(ref: DetailRef): number | null {
  for (const details of useDetailsStore.getState().details.values()) {
    const members =
      ref.kind === "planet"
        ? details.planets
        : ref.kind === "fleet"
          ? details.fleets_present
          : details.megastructures;
    if (members.some((m) => m.id === ref.id)) return details.id;
  }
  return null;
}

function laneExists({ a, b }: LaneRef): boolean {
  return (
    useGalaxyStore
      .getState()
      .systems.get(a)
      ?.lanes.some((l) => l.to === b) ?? false
  );
}
