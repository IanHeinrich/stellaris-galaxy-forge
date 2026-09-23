import { useMemo } from "react";
import { create } from "zustand";
import type { InitializerSet } from "../generated/InitializerSet";
import type { InitializerView } from "../generated/InitializerView";
import type { Op } from "../generated/Op";
import {
  browserGroups,
  notedRecent,
  pinToggle,
  type BrowserGroup,
} from "../lib/initializer/initializerBrowser";
import { isEmpireSpawn, modRefs } from "../lib/initializer/initializerGroups";
import { buildIndex, search, type SearchEntry } from "../lib/initializer/initializerSearch";
import { initializerCounts } from "../lib/initializer/initializerLabels";
import { useEditorStore } from "./editorStore";
import { useGalaxyStore, type Systems } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useMapChromeStore } from "./mapChromeStore";
import { PREF_KEYS } from "./prefKeys";
import { isStringArray, prefField } from "./prefs";

/** The choice that leaves the system to the game, which is no initializer at all. */
export const RANDOM_KEY = "@random";

export interface InitializerBrowserState {
  open: boolean;
  /** Whether the choice is written to existing systems or spawns a new one at `pending`. */
  mode: "assign" | "create";
  /** The systems the browser assigns to, captured when it was opened. */
  targets: number[];
  /** Where create mode puts the new system, in world coordinates. */
  pending: { x: number; y: number } | null;
  query: string;
  /** The group being listed, `null` for all of them. */
  group: string | null;
  /** [`RANDOM_KEY`] or an initializer key: what the detail pane shows and the map rings. */
  highlighted: string | null;
  pinned: string[];
  recent: string[];
  /** This machine's initializer for a new system, `null` for random. */
  defaultKey: string | null;
  /** What `assign` writes; back to the highlighted entry's default on every change of it. */
  spawnWeight: number | null;

  /** Opens the browser over `targets`, reading the initializers if that has not happened. */
  openFor(targets: number[]): void;
  /** Opens the browser to spawn a new system at a world point instead of assigning to one. */
  openToCreate(x: number, y: number): void;
  close(): void;
  setQuery(q: string): void;
  setGroup(id: string | null): void;
  highlight(key: string | null): void;
  setSpawnWeight(w: number | null): void;
  togglePin(key: string): void;
  /** Remembers the initializer a new system spawns from without being asked; `null` for random. */
  setDefault(key: string | null): void;
  /** Writes the highlighted choice to every target as one op; false when nothing was written. */
  assign(keepOpen?: boolean): Promise<boolean>;
}

const NO_INITIALIZERS: InitializerView[] = [];
const NO_MODS: ReadonlyArray<{ name: string; dir: string | null }> = [];

type Mods = ReadonlyArray<{ name: string; dir: string | null }>;

/** One lowercase haystack per initializer, over the game data handed in. */
export function searchEntries(
  list: readonly InitializerView[],
  mods: Mods,
  names: ReadonlyMap<string, string>,
): SearchEntry[] {
  return buildIndex(list, modRefs(mods), names);
}

function useSearchEntries(): SearchEntry[] {
  const list = useGameDataStore((s) => s.initializers);
  const mods = useGameDataStore((s) => s.summary?.mods);
  const names = useGameDataStore((s) => s.names);
  return useMemo(
    () => searchEntries(list ?? NO_INITIALIZERS, mods ?? NO_MODS, names),
    [list, mods, names],
  );
}

/** Every group the browser lists, each entry carrying how many systems already use it. */
export function browserGroupsOf(
  list: InitializerView[],
  mods: Mods,
  pinned: readonly string[],
  recent: readonly string[],
  systems: Systems,
): BrowserGroup[] {
  const counts = new Map(initializerCounts(systems.values()).map((c) => [c.key, c.count]));
  return browserGroups(list, modRefs(mods), pinned, recent, counts);
}

/** The tree the browser lists. */
export function useBrowserGroups(): BrowserGroup[] {
  const list = useGameDataStore((s) => s.initializers);
  const mods = useGameDataStore((s) => s.summary?.mods);
  const pinned = useInitializerBrowserStore((s) => s.pinned);
  const recent = useInitializerBrowserStore((s) => s.recent);
  const systems = useGalaxyStore((s) => s.systems);
  return useMemo(
    () => browserGroupsOf(list ?? NO_INITIALIZERS, mods ?? NO_MODS, pinned, recent, systems),
    [list, mods, pinned, recent, systems],
  );
}

/**
 * What the list shows: the query's hits, and with a group selected the hits it holds, in the
 * group's own order: pinned as pinned, recent by recency, the rest as the game data names them.
 */
export function visibleEntriesOf(
  entries: readonly SearchEntry[],
  query: string,
  group: string | null,
  tree: readonly BrowserGroup[],
): InitializerView[] {
  const hits = search(entries, query);
  if (group === null) return hits;
  const selected = tree.find((g) => g.id === group);
  if (selected === undefined) return [];
  const found = new Set(hits.map((entry) => entry.name));
  return selected.entries.filter((e) => found.has(e.entry.name)).map((e) => e.entry);
}

/** The entries the list draws, narrowed out of the tree its caller already holds. */
export function useVisibleEntries(tree: readonly BrowserGroup[]): InitializerView[] {
  const entries = useSearchEntries();
  const query = useInitializerBrowserStore((s) => s.query);
  const group = useInitializerBrowserStore((s) => s.group);
  return useMemo(
    () => visibleEntriesOf(entries, query, group, tree),
    [entries, query, group, tree],
  );
}

/** The highlighted initializer, or `null` for random and for a key the game data has lost. */
export function highlightedEntryOf(
  list: readonly InitializerView[],
  highlighted: string | null,
): InitializerView | null {
  if (highlighted === null || highlighted === RANDOM_KEY) return null;
  return list.find((entry) => entry.name === highlighted) ?? null;
}

/** The detail pane's entry. */
export function useHighlightedEntry(): InitializerView | null {
  const list = useGameDataStore((s) => s.initializers);
  const highlighted = useInitializerBrowserStore((s) => s.highlighted);
  return useMemo(
    () => highlightedEntryOf(list ?? NO_INITIALIZERS, highlighted),
    [list, highlighted],
  );
}

/** The initializer last assigned or created with, or `null` when nothing has been picked yet. */
export function lastUsed(): string | null {
  return useInitializerBrowserStore.getState().recent[0] ?? null;
}

/**
 * Only an empire's own starting system carries a weight; everything else, and any key the game
 * data does not have, writes none.
 */
export function spawnWeightFor(key: string | null): number | null {
  if (key === null || key === RANDOM_KEY) return null;
  const list = useGameDataStore.getState().initializers ?? NO_INITIALIZERS;
  const entry = highlightedEntryOf(list, key);
  return entry !== null && isEmpireSpawn(entry) ? 1 : null;
}

/**
 * One op for the whole assignment, whether it writes to one system or to many. The weight a
 * spawn point carries is its own op: assigning an initializer leaves whatever weight stands.
 */
function assignOp(targets: readonly number[], initializer: string | null): Op {
  return targets.length === 1
    ? { type: "SetInitializer", id: targets[0], initializer }
    : {
        type: "SetInitializers",
        entries: targets.map((id): InitializerSet => ({ id, initializer })),
      };
}

/** The map draws the random initializer under the empty key. */
function mapKey(key: string | null): string | null {
  if (key === null) return null;
  return key === RANDOM_KEY ? "" : key;
}

function isKey(value: unknown): value is string {
  return typeof value === "string";
}

const PINNED = prefField(PREF_KEYS.initializerPins, [], isStringArray);
const RECENT = prefField(PREF_KEYS.initializerRecent, [], isStringArray);
const DEFAULT_KEY = prefField<string | null>(PREF_KEYS.initializerDefault, null, isKey);

export const useInitializerBrowserStore = create<InitializerBrowserState>((set, get) => ({
  open: false,
  mode: "assign",
  targets: [],
  pending: null,
  query: "",
  group: null,
  highlighted: null,
  pinned: PINNED.read(),
  recent: RECENT.read(),
  defaultKey: DEFAULT_KEY.read(),
  spawnWeight: null,

  openFor(targets) {
    if (targets.length === 0) return;
    set({ open: true, mode: "assign", targets: [...targets], pending: null });
    if (useGameDataStore.getState().initializers === null) {
      void useGameDataStore.getState().loadInitializers();
    }
    useMapChromeStore.getState().setHighlightInitializer(mapKey(get().highlighted));
  },

  openToCreate(x, y) {
    set({ open: true, mode: "create", targets: [], pending: { x, y } });
    if (useGameDataStore.getState().initializers === null) {
      void useGameDataStore.getState().loadInitializers();
    }
    useMapChromeStore.getState().setHighlightInitializer(mapKey(get().highlighted));
  },

  close() {
    set({ open: false });
    useMapChromeStore.getState().setHighlightInitializer(null);
  },

  setQuery(query) {
    set({ query });
  },

  setGroup(group) {
    set({ group });
  },

  highlight(key) {
    if (get().highlighted === key) set({ highlighted: key });
    else set({ highlighted: key, spawnWeight: spawnWeightFor(key) });
    useMapChromeStore.getState().setHighlightInitializer(mapKey(key));
  },

  setSpawnWeight(spawnWeight) {
    set({ spawnWeight });
  },

  togglePin(key) {
    const pinned = pinToggle(get().pinned, key);
    set({ pinned });
    PINNED.save(pinned);
  },

  setDefault(key) {
    set({ defaultKey: key });
    DEFAULT_KEY.save(key);
  },

  async assign(keepOpen = false) {
    const { mode, targets, pending, highlighted, spawnWeight } = get();
    if (highlighted === null) return false;
    const random = highlighted === RANDOM_KEY;
    const initializer = random ? null : highlighted;
    const spawn_weight = random ? null : spawnWeight;
    const editor = useEditorStore.getState();
    let applied: boolean;
    if (mode === "create") {
      if (pending === null) return false;
      applied = await editor.addSystemAt(pending.x, pending.y, initializer, spawn_weight);
    } else {
      if (targets.length === 0) return false;
      applied = await editor.applySymmetric(assignOp(targets, initializer));
    }
    if (!applied) return false;
    if (!random) {
      const recent = notedRecent(get().recent, highlighted);
      set({ recent });
      RECENT.save(recent);
    }
    if (!keepOpen) get().close();
    return applied;
  },
}));
