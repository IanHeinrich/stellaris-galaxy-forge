import type { ClusterMember } from "../generated/ClusterMember";
import type { ClusterPick } from "../generated/ClusterPick";
import type { ClusterRoll } from "../generated/ClusterRoll";
import type { SpecialPick } from "../generated/SpecialPick";
import type { LayoutAdd } from "./addSystem";
import { pickedGroups, PINNED_GROUP, RECENT_GROUP, type PickedGroup } from "./browsePicks";
import { pairOf, type Pair } from "./geometry/pairs";
import type { Pt } from "./geometry/pt";
import { initializerLabel } from "./initializer/initializerLabels";
import { provisionalId } from "./placement/lanes";
import type { ShapePreview } from "./shapes/types";

/** A row of the Special picker: one layout, or a cluster of several systems placed together. */
export type SpecialEntry =
  { kind: "layout"; pick: SpecialPick } | { kind: "cluster"; pick: ClusterPick };

/** The key the picker's pins, recents and highlight name a row by. */
export function specialKey(entry: SpecialEntry): string {
  return entry.kind === "layout" ? entry.pick.layout.key : `cluster:${entry.pick.cluster.key}`;
}

/** The row's name. */
export function specialLabel(entry: SpecialEntry): string {
  return entry.kind === "layout" ? entry.pick.layout.label : entry.pick.cluster.label;
}

/** The picker's rows: the clusters, then the layouts. */
export function specialEntries(
  layouts: readonly SpecialPick[],
  clusters: readonly ClusterPick[],
): SpecialEntry[] {
  return [
    ...clusters.map((pick) => ({ kind: "cluster" as const, pick })),
    ...layouts.map((pick) => ({ kind: "layout" as const, pick })),
  ];
}

function byLabel(a: SpecialEntry, b: SpecialEntry): number {
  return specialLabel(a).localeCompare(specialLabel(b));
}

/**
 * The Special picker's own groups, each in label order and each left out when empty: the
 * clusters, the game's unique systems, its other special systems, then the layouts no galaxy
 * places, one group per mod that defines them, by name.
 */
export function specialGroups(entries: readonly SpecialEntry[]): PickedGroup<SpecialEntry>[] {
  const layouts = entries.flatMap((e) => (e.kind === "layout" ? [e] : []));
  const placed = layouts.filter((e) => e.pick.layout.group === null);
  const mods = [...new Set(layouts.flatMap((e) => e.pick.layout.group ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
  return [
    { id: "clusters", label: "Clusters", entries: entries.filter((e) => e.kind === "cluster") },
    { id: "unique", label: "Unique systems", entries: placed.filter((e) => e.pick.layout.unique) },
    {
      id: "other",
      label: "Other special systems",
      entries: placed.filter((e) => !e.pick.layout.unique),
    },
    ...mods.map((mod) => ({
      id: `mod:${mod}`,
      label: mod,
      entries: layouts.filter((e) => e.pick.layout.group === mod),
    })),
  ]
    .map((group) => ({ ...group, entries: [...group.entries].sort(byLabel) }))
    .filter((group) => group.entries.length > 0);
}

/** The groups the picker's tree lists: the pinned and recent rows, then its own groups. */
export function specialTree(
  entries: readonly SpecialEntry[],
  pinned: readonly string[],
  recent: readonly string[],
): PickedGroup<SpecialEntry>[] {
  return [...pickedGroups(entries, specialKey, pinned, recent), ...specialGroups(entries)];
}

/**
 * The rows the list shows: the group's, or with none every one of the picker's own groups in turn,
 * less those whose name does not hold the query.
 */
export function visibleSpecials(
  tree: readonly PickedGroup<SpecialEntry>[],
  group: string | null,
  query: string,
): SpecialEntry[] {
  const rows =
    group === null
      ? tree
          .filter((g) => g.id !== PINNED_GROUP.id && g.id !== RECENT_GROUP.id)
          .flatMap((g) => g.entries)
      : (tree.find((g) => g.id === group)?.entries ?? []);
  const words = query.trim().toLowerCase();
  return words === "" ? rows : rows.filter((e) => specialLabel(e).toLowerCase().includes(words));
}

/** A highlighted cluster's places: being rolled, rolled, or why they could not be. */
export type ClusterRollState =
  { kind: "rolling" } | { kind: "rolled"; roll: ClusterRoll } | { kind: "failed"; reason: string };

export const CLUSTER_ROLLING = "Rolling the cluster's places…";

/**
 * What the picker calls a member: the name the add writes, or where the game names the system
 * itself, as a scenario's statement leaves it to, its layout as the initializer browser lists it.
 */
export function memberName(member: ClusterMember, how: LayoutAdd["kind"]): string {
  return how === "built" ? member.name : initializerLabel(member.layout);
}

/** Why the cluster rolled as `state` cannot be placed: the first refused member, by name; null when it can. */
export function clusterRefusal(state: ClusterRollState): string | null {
  switch (state.kind) {
    case "rolling":
      return CLUSTER_ROLLING;
    case "failed":
      return state.reason;
    case "rolled": {
      const refused = state.roll.members.find((m) => m.refused !== null);
      return refused ? `${refused.name}: ${refused.refused}` : null;
    }
  }
}

/**
 * A cluster's roll as the Shape tool's preview draws it: the members whose place is taken as new
 * systems in their stars' colours with the lanes between them, and the refused ones as points
 * left outside, with no lanes.
 */
export function clusterPlacement({ members, lanes }: ClusterRoll): ShapePreview {
  const fits = members.flatMap((m, i) => (m.refused === null ? [i] : []));
  const point = new Map(fits.map((member, index) => [member, index]));
  const pairs = lanes.flatMap(([a, b]): Pair[] => {
    const p = point.get(a);
    const q = point.get(b);
    return p === undefined || q === undefined ? [] : [pairOf(provisionalId(p), provisionalId(q))];
  });
  const at = ({ x, y }: Pt): Pt => ({ x, y });
  return {
    points: fits.map((i) => at(members[i])),
    pairs,
    left: [],
    outside: members.filter((m) => m.refused !== null).map(at),
    overlaps: 0,
    crowded: 0,
    capped: false,
    interleaved: null,
    classes: fits.map((i) => members[i].star_class),
    arranged: null,
  };
}
