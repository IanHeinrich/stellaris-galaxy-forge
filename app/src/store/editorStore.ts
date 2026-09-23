import { confirm } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { FeDirection } from "../generated/FeDirection";
import type { FeZone } from "../generated/FeZone";
import type { HistoryEntry } from "../generated/HistoryEntry";
import type { HistoryView } from "../generated/HistoryView";
import type { Pair } from "../lib/geometry/pairs";
import type { Pt } from "../lib/geometry/pt";
import type { Op } from "../generated/Op";
import type { SearchHit } from "../generated/SearchHit";
import type { SearchResult } from "../generated/SearchResult";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemDetail } from "../generated/SystemDetail";
import type { SystemNode } from "../generated/SystemNode";
import { enabledScriptFor, nextSystemId, nextWormholePair, sharedWormholePair } from "../lib/paint";
import { counted } from "../lib/text";
import { editPipeline, systems } from "./editorEdits";
import { brushActions } from "./editorStore.brush";
import { feZoneActions } from "./editorStore.feZones";
import { laneActions } from "./editorStore.lanes";
import { marauderActions } from "./editorStore.marauders";
import { nebulaActions } from "./editorStore.nebulae";
import { searchActions } from "./editorStore.search";
import { canEdit, getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { symmetricIds, symmetricOp } from "./symmetricEdits";

export type { MapTooltip, MapTooltipLine, MapTooltipText } from "./mapChromeStore";
export { nearestSystem } from "./editorEdits";
export { NEEDS_A_SYSTEM, NOTHING_TO_FIT } from "./editorStore.feZones";
export { CONNECT_ALL_MAX } from "./editorStore.lanes";
export { DEFAULT_NEBULA_RADIUS } from "./editorStore.nebulae";

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

/** What Delete removes: the selected nebula, the selected lane, or the selected systems. */
export type Deletable =
  | { kind: "nebula"; index: number }
  | { kind: "lane"; lane: LaneRef }
  | { kind: "systems"; ids: number[] };

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
  /** Every system the search palette's current query locates; the map rings them. */
  searchRings: number[];
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
  /**
   * Searches for `text` and rings what the result locates. Resolves null when a later search or
   * a clear has overtaken it; a failure clears the rings and rejects.
   */
  runSearch(text: string, limit: number): Promise<SearchResult | null>;
  /** Drops the rings and whatever search is still on its way. */
  clearSearch(): void;
  setHover(id: number | null): void;
  requestFit(): void;
  /** Frames the selected systems, or the whole galaxy when nothing is selected. */
  fitSelection(): void;
  /** Removes what `deletableSelection` names, asking first for a nebula or systems. */
  deleteSelection(): Promise<void>;
  /** Moves every selected system by a world offset in one op. */
  nudgeSelection(dx: number, dy: number): Promise<void>;
  /** Moves the nebula at `index` (file order) to a world position. Nothing else moves. */
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
  /**
   * Removes the nebula at `index` once the user has agreed to the systems that leave it,
   * renumbering the ones after it, and deselects.
   */
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
  /** Removes `ids` and every lane touching them in one edit, once the user has confirmed. */
  removeSystems(ids: number[]): Promise<boolean>;
  /**
   * Adds a paint stroke's systems at `points`, numbered from the next free id, and its lanes in
   * one edit; a pair's negative id -k names `points[k - 1]`.
   */
  paintStroke(points: readonly Pt[], pairs: readonly Pair[]): Promise<boolean>;
  /** Removes the systems an erase stroke swept, in one edit. */
  eraseStroke(ids: readonly number[]): Promise<boolean>;
  /** Cuts the lanes an erase or cut stroke swept, in one edit. */
  cutLanes(pairs: Pair[]): Promise<boolean>;
  /** Adds the lanes a connect stroke found between the systems it swept, in one edit. */
  connectStroke(pairs: readonly Pair[]): Promise<boolean>;
  /**
   * Links every separate cluster of systems into one with the shortest lanes that cross none,
   * in one edit; nothing is sent when the galaxy is already one piece.
   */
  joinIslands(): Promise<boolean>;
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
  /** Adds `system` to the systems the mod lays hyperlanes from into the zone `anchor` anchors. */
  linkToFeZone(anchor: number, system: number): Promise<boolean>;
  /**
   * Adds every one of `ids` that can be linked to the zone `anchor` anchors, in one edit; the
   * ones that cannot are left out, and only when none can is the first refusal reported.
   */
  linkToFeZoneAll(anchor: number, ids: number[]): Promise<boolean>;
  /** Takes `system` out of the systems linked to the zone `anchor` anchors. */
  unlinkFromFeZone(anchor: number, system: number): Promise<boolean>;
  /** Gives the zone `anchor` anchors back to the mod's own rule: no custom connections at all. */
  resetFeLinks(anchor: number): Promise<boolean>;
  /** Takes `system` off every connection id no zone anchor takes; its links to zones stay. */
  dropDanglingFeLinks(system: number): Promise<boolean>;
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
  /** Applies `op` and, under the global symmetry, the same edit to every counterpart, as one edit. */
  applySymmetric(op: Op): Promise<boolean>;
  /**
   * Sets the seat `seat` makes of system `id` and, under the global symmetry, the one it makes of
   * each counterpart, as one edit. `seat` leaves a system it returns undefined for as it is, and
   * a seat reserved for one empire goes on `id` alone.
   */
  setSeat(
    id: number,
    seat: (system: SystemNode) => SpawnScript | null | undefined,
  ): Promise<boolean>;
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
  searchRings: [] as number[],
  history: { undo: [], redo: [] } as HistoryView,
  nebulaPrompt: null as { x: number; y: number } | null,
  feZoneFitPrompt: null as { candidates: number; automatic: number } | null,
} satisfies Partial<EditorState>;

export const useEditorStore = create<EditorState>((set, get) => {
  const edits = editPipeline(set, get, (ids) => selectSystems(ids, false));
  return {
    ...INITIAL,
    fitNonce: 0,
    fitSelectionNonce: 0,
    ...edits.actions,
    ...nebulaActions(set, get, edits.runEdit),
    ...laneActions(set, get),
    ...feZoneActions(set, get, edits.runEdit),
    ...marauderActions(set, get),
    ...brushActions(set, get, edits.runEdit),
    ...searchActions(set, get),

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
      const target = deletableSelection(get());
      if (target === null) return;
      switch (target.kind) {
        case "nebula":
          await get().removeNebula(target.index);
          return;
        case "systems":
          await (target.ids.length === 1
            ? get().removeSystem(target.ids[0])
            : get().removeSystems(target.ids));
          return;
        case "lane": {
          const { a, b } = target.lane;
          if (await get().applySymmetric({ type: "RemoveLane", a, b })) set({ selectedLane: null });
        }
      }
    },

    async nudgeSelection(dx, dy) {
      const moves = get().selection.flatMap((id) => {
        const s = systems().get(id);
        return s ? [{ id, x: s.x + dx, y: s.y + dy }] : [];
      });
      if (moves.length === 0) return;
      await get().applySymmetric(
        moves.length === 1 ? { type: "MoveSystem", ...moves[0] } : { type: "MoveSystems", moves },
      );
    },

    async addSystemAt(x, y, initializer = null, spawnWeight = null) {
      // Under the Paint a Galaxy profile the weight is the site's script, keyed to the id the core will give.
      const paint = getPaintLayer() && spawnWeight !== null;
      const op: Op = {
        type: "AddSystem",
        id: null,
        x,
        y,
        name: null,
        initializer,
        spawn_weight: paint ? null : spawnWeight,
        spawn_script: paint ? enabledScriptFor(nextSystemId(systems().values())) : null,
      };
      const result = await edits.runEdit(() => ipc.applyOp(symmetricOp(op)));
      if (result === null) return false;
      const added = nearestTo(result.delta.systems, x, y);
      if (added) await get().select(added.id);
      return true;
    },

    async removeSystem(id) {
      const system = systems().get(id);
      if (!system) return;
      if (symmetricIds([id]).length > 1) {
        await get().removeSystems([id]);
        return;
      }
      const name = useGalaxyStore.getState().systemName(id);
      const lanes = system.lanes.length;
      const what = lanes === 0 ? name : `${name} and its ${counted(lanes, "lane")}`;
      if (!(await confirm(`Delete ${what}?`, { title: name, kind: "warning" }))) return;
      await get().applyOp({ type: "RemoveSystem", id });
    },

    async updateEmpireCounts() {
      await edits.runEdit(async () => {
        const entries = await ipc.headerEmpireCounts();
        return ipc.applyOp({ type: "SetHeaderKeys", entries });
      });
    },

    async linkWormholePair(a, b) {
      const pair = nextWormholePair(systems().values());
      const linked = await get().applyOp({ type: "SetWormholePair", a, b, pair });
      if (linked) useMapChromeStore.getState().setLayerQuietly("day_one_bypasses", true);
      return linked;
    },

    async unlinkWormholePair(a, b) {
      if (sharedWormholePair(systems(), a, b) === null) return false;
      return get().applyOp({ type: "SetWormholePair", a, b, pair: null });
    },

    resetSession() {
      edits.newSession();
      set({ ...INITIAL });
    },
  };
});

/**
 * What Delete would remove, or null for nothing: the selected nebula or lane, or the selected
 * systems while the document makes and deletes them. The Edit menu and the key both ask it.
 */
export function deletableSelection(
  state: Pick<EditorState, "selection" | "selectedLane" | "selectedNebula">,
  systemsDeletable = canEdit("create_systems"),
): Deletable | null {
  const { selection, selectedLane, selectedNebula } = state;
  if (selectedNebula !== null) return { kind: "nebula", index: selectedNebula };
  if (selectedLane !== null) return { kind: "lane", lane: selectedLane };
  if (selection.length > 0 && systemsDeletable) return { kind: "systems", ids: selection };
  return null;
}

export function canDelete(state: EditorState, systemsDeletable?: boolean): boolean {
  return deletableSelection(state, systemsDeletable) !== null;
}

/** The step Undo takes back; undefined with none. */
export function nextUndo(state: EditorState): HistoryEntry | undefined {
  return state.history.undo[state.history.undo.length - 1];
}

/** The step Redo puts back; undefined with none. */
export function nextRedo(state: EditorState): HistoryEntry | undefined {
  return state.history.redo[0];
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

/** Of `nodes`, the one nearest (x, y). */
function nearestTo(nodes: readonly SystemNode[], x: number, y: number): SystemNode | undefined {
  let best: SystemNode | undefined;
  for (const n of nodes) {
    if (!best || Math.hypot(n.x - x, n.y - y) < Math.hypot(best.x - x, best.y - y)) best = n;
  }
  return best;
}
