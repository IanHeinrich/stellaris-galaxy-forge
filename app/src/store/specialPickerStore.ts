import { useMemo } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { PickedGroup } from "../lib/browsePicks";
import type { Pt } from "../lib/geometry/pt";
import { newSeed } from "../lib/random";
import {
  clusterRefusal,
  specialEntries,
  specialKey,
  specialTree,
  visibleSpecials,
  type ClusterRollState,
  type SpecialEntry,
} from "../lib/specialPicks";
import { browseSlice, type BrowseState } from "./browseSlice";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, prefField } from "./prefs";
import { latest } from "./reads";

/** The Special picker, whose `highlighted` is a row's `specialKey`. */
export interface SpecialPickerState extends BrowseState {
  open: boolean;
  /** The world point the picked layout goes at, or a cluster's home. */
  at: Pt | null;
  /** The same point in the map area's pixels, which the dialog opens beside. */
  anchor: Pt | null;
  /** The rows the open document offers, read each time the picker opens; null until they land. */
  entries: SpecialEntry[] | null;
  /** Whether the layout comes with its anomalies, dig sites and megastructures; remembered. */
  extras: boolean;
  /** What a cluster's places are rolled from: a new one each time the picker opens, and on Shuffle. */
  seed: number;
  /** The highlighted cluster rolled at the point from `seed`; null while no cluster is highlighted. */
  roll: ClusterRollState | null;

  /** Opens the picker for the world point `at`, right-clicked at `anchor` in the map area. */
  openAt(at: Pt, anchor: Pt): void;
  close(): void;
  setExtras(extras: boolean): void;
  /** Rolls the highlighted cluster's places again from a new seed. */
  shuffle(): void;
  /**
   * Adds the highlighted layout at the point, or the highlighted cluster as rolled, and closes;
   * false when nothing was added.
   */
  place(): Promise<boolean>;
}

const EXTRAS = prefField(PREF_KEYS.specialExtras, true, isBoolean);
const NO_ENTRIES: SpecialEntry[] = [];

/** The row `key` names among `entries`, or null. */
function entryOf(entries: readonly SpecialEntry[] | null, key: string | null): SpecialEntry | null {
  if (key === null) return null;
  return entries?.find((e) => specialKey(e) === key) ?? null;
}

export const useSpecialPickerStore = create<SpecialPickerState>((set, get) => {
  const reads = latest();
  const rolls = latest();
  const entryNow = (key: string | null) => entryOf(get().entries, key);

  /** Reads the rows the open document offers, then rolls a cluster left highlighted. */
  async function readEntries() {
    const token = reads.next();
    try {
      const [layouts, clusters] = await Promise.all([
        ipc.getSpecialLayouts(),
        ipc.getSpecialClusters(),
      ]);
      if (!reads.is(token)) return;
      set({ entries: specialEntries(layouts, clusters) });
      void rollCluster();
    } catch (e) {
      if (!reads.is(token)) return;
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      get().close();
    }
  }

  /** Rolls the highlighted cluster at the point, dropping an answer a newer roll overtook. */
  async function rollCluster() {
    const token = rolls.next();
    const { open, at, seed, highlighted } = get();
    const entry = entryNow(highlighted);
    if (!open || at === null || entry?.kind !== "cluster") {
      if (get().roll !== null) set({ roll: null });
      return;
    }
    set({ roll: { kind: "rolling" } });
    try {
      const roll = await ipc.rollSpecialCluster(seed, at.x, at.y, entry.pick.cluster.key);
      if (rolls.is(token)) set({ roll: { kind: "rolled", roll } });
    } catch (e) {
      if (rolls.is(token)) set({ roll: { kind: "failed", reason: ipc.errorMessage(e) } });
    }
  }

  const browse = browseSlice(set, get, {
    pinned: PREF_KEYS.specialPins,
    recent: PREF_KEYS.specialRecent,
  });

  return {
    ...browse,
    open: false,
    at: null,
    anchor: null,
    entries: null,
    extras: EXTRAS.read(),
    seed: 0,
    roll: null,

    highlight(key) {
      if (key === get().highlighted) return;
      browse.highlight(key);
      void rollCluster();
    },

    openAt(at, anchor) {
      set({ open: true, at: { ...at }, anchor: { ...anchor }, seed: newSeed(), entries: null });
      void rollCluster();
      void readEntries();
    },

    close() {
      reads.next();
      rolls.next();
      set({ open: false, roll: null, entries: null });
    },

    setExtras(extras) {
      set({ extras });
      EXTRAS.save(extras);
    },

    shuffle() {
      set({ seed: newSeed() });
      void rollCluster();
    },

    async place() {
      const { at, highlighted, extras, seed, roll } = get();
      const entry = entryNow(highlighted);
      if (at === null || highlighted === null || entry === null) return false;
      const editor = useEditorStore.getState();
      let added: boolean;
      switch (entry.kind) {
        case "layout":
          added = await editor.addSpecialSystemAt(at.x, at.y, entry.pick.layout.key, extras);
          break;
        case "cluster":
          if (roll === null || clusterRefusal(roll) !== null) return false;
          added = await editor.addSpecialClusterAt(
            seed,
            at.x,
            at.y,
            entry.pick.cluster.key,
            extras,
          );
          break;
      }
      if (!added) return false;
      get().noteRecent(highlighted);
      get().close();
      return true;
    },
  };
});

/** The rows the open document offers, once read. */
function useSpecialEntries(): SpecialEntry[] {
  return useSpecialPickerStore((s) => s.entries ?? NO_ENTRIES);
}

/** The groups the picker's tree lists. */
export function useSpecialTree(): PickedGroup<SpecialEntry>[] {
  const entries = useSpecialEntries();
  const pinned = useSpecialPickerStore((s) => s.pinned);
  const recent = useSpecialPickerStore((s) => s.recent);
  return useMemo(() => specialTree(entries, pinned, recent), [entries, pinned, recent]);
}

/** The rows the list draws, narrowed out of the tree its caller already holds. */
export function useVisibleSpecials(tree: readonly PickedGroup<SpecialEntry>[]): SpecialEntry[] {
  const group = useSpecialPickerStore((s) => s.group);
  const query = useSpecialPickerStore((s) => s.query);
  return useMemo(() => visibleSpecials(tree, group, query), [tree, group, query]);
}

/** The detail pane's row, or null while nothing the save offers is highlighted. */
export function useHighlightedSpecial(): SpecialEntry | null {
  const entries = useSpecialEntries();
  const highlighted = useSpecialPickerStore((s) => s.highlighted);
  return useMemo(
    () => entries.find((e) => specialKey(e) === highlighted) ?? null,
    [entries, highlighted],
  );
}
