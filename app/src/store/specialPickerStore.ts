import { useMemo } from "react";
import { create } from "zustand";
import type { SpecialPick } from "../generated/SpecialPick";
import type { PickedGroup } from "../lib/browsePicks";
import type { Pt } from "../lib/geometry/pt";
import { specialTree, visibleSpecials } from "../lib/specialPicks";
import { browseSlice, type BrowseState } from "./browseSlice";
import { useEditorStore } from "./editorStore";
import { useGeneratorStore } from "./generatorStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, prefField } from "./prefs";

/** The Special picker, whose `highlighted` is a special layout's key. */
export interface SpecialPickerState extends BrowseState {
  open: boolean;
  /** The world point the picked layout goes at. */
  at: Pt | null;
  /** The same point in the map area's pixels, which the dialog opens beside. */
  anchor: Pt | null;
  /** Whether the layout comes with its anomalies, dig sites and megastructures; remembered. */
  extras: boolean;

  /** Opens the picker for the world point `at`, right-clicked at `anchor` in the map area. */
  openAt(at: Pt, anchor: Pt): void;
  close(): void;
  setExtras(extras: boolean): void;
  /** Adds the highlighted layout at the point and closes; false when nothing was added. */
  place(): Promise<boolean>;
}

const EXTRAS = prefField(PREF_KEYS.specialExtras, true, isBoolean);
const NO_PICKS: SpecialPick[] = [];

export const useSpecialPickerStore = create<SpecialPickerState>((set, get) => ({
  ...browseSlice(set, get, { pinned: PREF_KEYS.specialPins, recent: PREF_KEYS.specialRecent }),
  open: false,
  at: null,
  anchor: null,
  extras: EXTRAS.read(),

  openAt(at, anchor) {
    set({ open: true, at: { ...at }, anchor: { ...anchor } });
  },

  close() {
    set({ open: false });
  },

  setExtras(extras) {
    set({ extras });
    EXTRAS.save(extras);
  },

  async place() {
    const { at, highlighted, extras } = get();
    if (at === null || highlighted === null) return false;
    const added = await useEditorStore
      .getState()
      .addSpecialSystemAt(at.x, at.y, highlighted, extras);
    if (!added) return false;
    get().noteRecent(highlighted);
    get().close();
    return true;
  },
}));

/** The special layouts the open save offers, once read. */
function useSpecialPicks(): SpecialPick[] {
  return useGeneratorStore((s) => s.picks?.special ?? NO_PICKS);
}

/** The groups the picker's tree lists. */
export function useSpecialTree(): PickedGroup<SpecialPick>[] {
  const picks = useSpecialPicks();
  const pinned = useSpecialPickerStore((s) => s.pinned);
  const recent = useSpecialPickerStore((s) => s.recent);
  return useMemo(() => specialTree(picks, pinned, recent), [picks, pinned, recent]);
}

/** The rows the list draws, narrowed out of the tree its caller already holds. */
export function useVisibleSpecials(tree: readonly PickedGroup<SpecialPick>[]): SpecialPick[] {
  const group = useSpecialPickerStore((s) => s.group);
  const query = useSpecialPickerStore((s) => s.query);
  return useMemo(() => visibleSpecials(tree, group, query), [tree, group, query]);
}

/** The detail pane's layout, or null while nothing the save offers is highlighted. */
export function useHighlightedSpecial(): SpecialPick | null {
  const picks = useSpecialPicks();
  const highlighted = useSpecialPickerStore((s) => s.highlighted);
  return useMemo(
    () => picks.find((p) => p.layout.key === highlighted) ?? null,
    [picks, highlighted],
  );
}
