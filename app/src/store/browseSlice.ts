import { notedRecent, pinToggle } from "../lib/browsePicks";
import type { PrefKey } from "./prefKeys";
import { isStringArray, prefField } from "./prefs";

/** What every browser dialog keeps: its search, its group, its highlight and its picks. */
export interface BrowseState {
  query: string;
  /** The group being listed, `null` for all of them. */
  group: string | null;
  /** The key of the row the list highlights and the detail pane shows. */
  highlighted: string | null;
  pinned: string[];
  recent: string[];
  setQuery(query: string): void;
  setGroup(id: string | null): void;
  highlight(key: string | null): void;
  togglePin(key: string): void;
  /** Notes `key` as the newest recent pick. */
  noteRecent(key: string): void;
}

/** Where a browser keeps its pins and its recent picks on this machine. */
export interface BrowsePrefs {
  pinned: PrefKey;
  recent: PrefKey;
}

/** The state and the actions every browser's store shares, its picks read from `prefs`. */
export function browseSlice(
  set: (partial: Partial<BrowseState>) => void,
  get: () => BrowseState,
  prefs: BrowsePrefs,
): BrowseState {
  const pinnedPref = prefField(prefs.pinned, [], isStringArray);
  const recentPref = prefField(prefs.recent, [], isStringArray);
  return {
    query: "",
    group: null,
    highlighted: null,
    pinned: pinnedPref.read(),
    recent: recentPref.read(),
    setQuery: (query) => set({ query }),
    setGroup: (group) => set({ group }),
    highlight: (highlighted) => set({ highlighted }),

    togglePin(key) {
      const pinned = pinToggle(get().pinned, key);
      set({ pinned });
      pinnedPref.save(pinned);
    },

    noteRecent(key) {
      const recent = notedRecent(get().recent, key);
      set({ recent });
      recentPref.save(recent);
    },
  };
}
