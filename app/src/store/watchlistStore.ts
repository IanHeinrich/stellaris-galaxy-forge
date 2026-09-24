import { create } from "zustand";
import * as ipc from "../api/ipc";
import { renumberedIds, type Renumbering } from "../lib/renumber";
import { nextColour, pinnedEntry, type WatchEntry } from "../lib/watchlist";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, prefField } from "./prefs";

/** Only the located systems are read, and no limit caps those. */
const HITS = 1;

export interface WatchlistState {
  entries: WatchEntry[];
  /** The systems each entry's query locates in the open document, by query. */
  results: ReadonlyMap<string, readonly number[]>;
  /** Adds a search to the list; false for an empty one or one already on it. */
  pin(query: string): boolean;
  /** Takes off the entry that is the same search as `query`, whatever its case. */
  unpin(query: string): void;
  /** Pins `query`, or unpins it when it already is; true when it is pinned afterwards. */
  togglePin(query: string): boolean;
  remove(query: string): void;
  /** Empties the list. */
  clear(): void;
  toggleShown(query: string): void;
  /** Runs every entry against the open document. */
  refresh(): Promise<void>;
  clearResults(): void;
  /** Moves the systems each entry found as an edit renumbered them, until the next refresh reads them again. */
  renumber(pairs: Renumbering): void;
}

function isEntry(value: unknown): value is WatchEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.query === "string" && isFiniteNumber(entry.colour) && isBoolean(entry.shown);
}

function isEntries(value: unknown): value is WatchEntry[] {
  return Array.isArray(value) && value.every(isEntry);
}

const ENTRIES = prefField<WatchEntry[]>(PREF_KEYS.watchlist, [], isEntries);

/** The pinned searches as the preferences hold them. */
export function storedWatchlist(): WatchEntry[] {
  return ENTRIES.read();
}

const NO_RESULTS: ReadonlyMap<string, readonly number[]> = new Map();

async function systemsFor(query: string): Promise<readonly [string, readonly number[]]> {
  try {
    return [query, (await ipc.search(query, HITS)).systems];
  } catch {
    return [query, []];
  }
}

export const useWatchlistStore = create<WatchlistState>((set, get) => {
  let latest = 0;
  const keep = (entries: WatchEntry[]) => {
    set({ entries });
    ENTRIES.save(entries);
  };
  return {
    entries: storedWatchlist(),
    results: NO_RESULTS,

    pin(query) {
      const text = query.trim();
      const { entries } = get();
      if (text === "" || pinnedEntry(entries, text) !== undefined) return false;
      const colour = nextColour(entries.map((entry) => entry.colour));
      keep([...entries, { query: text, colour, shown: true }]);
      if (useFileSessionStore.getState().status === "ready") void get().refresh();
      return true;
    },

    unpin(query) {
      const entry = pinnedEntry(get().entries, query);
      if (entry !== undefined) get().remove(entry.query);
    },

    togglePin(query) {
      if (pinnedEntry(get().entries, query) === undefined) return get().pin(query);
      get().unpin(query);
      return false;
    },

    remove(query) {
      keep(get().entries.filter((entry) => entry.query !== query));
      const results = new Map(get().results);
      if (results.delete(query)) set({ results });
    },

    clear() {
      latest++;
      keep([]);
      set({ results: NO_RESULTS });
    },

    toggleShown(query) {
      keep(
        get().entries.map((entry) =>
          entry.query === query ? { ...entry, shown: !entry.shown } : entry,
        ),
      );
    },

    async refresh() {
      const seq = ++latest;
      const answers = await Promise.all(get().entries.map((entry) => systemsFor(entry.query)));
      if (seq !== latest) return;
      set({ results: answers.length === 0 ? NO_RESULTS : new Map(answers) });
    },

    renumber(pairs) {
      const { results } = get();
      let moved = false;
      const next = new Map<string, readonly number[]>();
      for (const [query, ids] of results) {
        const after = renumberedIds(pairs, ids);
        moved ||= after !== ids;
        next.set(query, after);
      }
      if (moved) set({ results: next });
    },

    clearResults() {
      latest++;
      if (get().results.size > 0) set({ results: NO_RESULTS });
    },
  };
});
