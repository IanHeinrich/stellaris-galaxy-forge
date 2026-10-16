import type { SpecialPick } from "../generated/SpecialPick";
import { pickedGroups, PINNED_GROUP, RECENT_GROUP, type PickedGroup } from "./browsePicks";

/** The key the picker's pins, recents and highlight name a layout by. */
export function specialKey(pick: SpecialPick): string {
  return pick.layout.key;
}

function byLabel(a: SpecialPick, b: SpecialPick): number {
  return a.layout.label.localeCompare(b.layout.label);
}

/**
 * The Special picker's own groups, each in label order and each left out when empty: the game's
 * unique systems, its other special systems, then the layouts no galaxy places, one group per mod
 * that defines them, by name.
 */
export function specialGroups(picks: readonly SpecialPick[]): PickedGroup<SpecialPick>[] {
  const placed = picks.filter((p) => p.layout.group === null);
  const mods = [...new Set(picks.flatMap((p) => p.layout.group ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
  return [
    { id: "unique", label: "Unique systems", entries: placed.filter((p) => p.layout.unique) },
    {
      id: "other",
      label: "Other special systems",
      entries: placed.filter((p) => !p.layout.unique),
    },
    ...mods.map((mod) => ({
      id: `mod:${mod}`,
      label: mod,
      entries: picks.filter((p) => p.layout.group === mod),
    })),
  ]
    .map((group) => ({ ...group, entries: [...group.entries].sort(byLabel) }))
    .filter((group) => group.entries.length > 0);
}

/** The groups the picker's tree lists: the pinned and recent picks, then its own groups. */
export function specialTree(
  picks: readonly SpecialPick[],
  pinned: readonly string[],
  recent: readonly string[],
): PickedGroup<SpecialPick>[] {
  return [...pickedGroups(picks, specialKey, pinned, recent), ...specialGroups(picks)];
}

/**
 * The rows the list shows: the group's, or with none every one of the picker's own groups in turn,
 * less those whose name does not hold the query.
 */
export function visibleSpecials(
  tree: readonly PickedGroup<SpecialPick>[],
  group: string | null,
  query: string,
): SpecialPick[] {
  const rows =
    group === null
      ? tree
          .filter((g) => g.id !== PINNED_GROUP.id && g.id !== RECENT_GROUP.id)
          .flatMap((g) => g.entries)
      : (tree.find((g) => g.id === group)?.entries ?? []);
  const words = query.trim().toLowerCase();
  return words === "" ? rows : rows.filter((p) => p.layout.label.toLowerCase().includes(words));
}
