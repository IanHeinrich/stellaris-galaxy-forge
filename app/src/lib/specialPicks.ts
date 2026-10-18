import type { ClusterMember } from "../generated/ClusterMember";
import type { ClusterPick } from "../generated/ClusterPick";
import type { ClusterRoll } from "../generated/ClusterRoll";
import type { SpecialPick } from "../generated/SpecialPick";
import type { LayoutAdd } from "./addSystem";
import { pickedGroups, PINNED_GROUP, RECENT_GROUP, type PickedGroup } from "./browsePicks";
import { pairOf, type Pair } from "./geometry/pairs";
import type { Pt } from "./geometry/pt";
import { initializerLabel } from "./initializer/initializerLabels";
import { FollowGround, type ImageOfNew, type PlacementGround } from "./placement/ground";
import { placedLanes, provisionalId, provisionalIndex } from "./placement/lanes";
import { LEAST_SPACING, MOST_SPACING } from "./placement/limits";
import type { ShapePreview } from "./shapes/types";
import { SPAWN_BUFFER } from "../generated/constants";
import { boxAround, type Rect } from "./menuAim";

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

/**
 * Why the cluster rolled as `state` cannot be placed: the first refused member, by name; null when
 * it can. With no roll yet, it is still being rolled.
 */
export function clusterRefusal(state: ClusterRollState | null): string | null {
  switch (state?.kind) {
    case undefined:
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

/** A system the picker would add: where it stands, its star class once rolled, and why its place is refused. */
export interface NewPlace {
  x: number;
  y: number;
  star_class: string | null;
  refused: string | null;
}

/** The systems the picker would add, and the lanes between them by index, which the add lays. */
export interface NewSystems {
  places: readonly NewPlace[];
  lanes: ReadonlyArray<readonly [number, number]>;
}

/** A lane from new system `index` to the existing system `system`. */
export type Link = [index: number, system: number];

/** A cluster's roll as the systems it adds. */
export function rolledSystems({ members, lanes }: ClusterRoll): NewSystems {
  return { places: members, lanes };
}

const NO_SYMMETRY: ImageOfNew = () => null;

/**
 * The lanes that join `added` to the existing systems near it, as the Shape tool's New and nearby
 * lanes are laid: meshed at the Lane density, crossing no lane, the new systems' own included, and
 * reaching `LANE_REACH` times as far as the existing system nearest them stands.
 */
export function specialLinks(added: NewSystems, ground: PlacementGround, density: number): Link[] {
  const points = added.places.map(({ x, y }) => ({ x, y }));
  let nearest = Infinity;
  for (const p of points) {
    const near = ground.grid.nearestSystem(p.x, p.y, MOST_SPACING);
    if (near) nearest = Math.min(nearest, Math.hypot(near.x - p.x, near.y - p.y));
  }
  if (!Number.isFinite(nearest)) return [];
  const own = added.lanes.map(([a, b]) => ({
    a: { id: provisionalId(a), ...points[a] },
    b: { id: provisionalId(b), ...points[b] },
  }));
  const pairs = placedLanes({
    points,
    base: points.length,
    mode: "nearby",
    density,
    spacing: Math.max(nearest, LEAST_SPACING),
    ground: own.length > 0 ? new FollowGround(ground, own) : ground,
    imageOfNew: NO_SYMMETRY,
    keep: (a, b) => a < 0 !== b < 0,
    islandSeed: null,
  });
  return pairs.map(([a, b]): Link => [provisionalIndex(Math.min(a, b)), Math.max(a, b)]);
}

/**
 * What the picker would add as the Shape tool's preview draws it: the systems whose place is taken,
 * in their stars' colours once rolled, with their own lanes and `links`, and the refused ones as
 * points left outside, with no lanes.
 */
export function specialPlacement(added: NewSystems, links: readonly Link[]): ShapePreview {
  const { places, lanes } = added;
  const fits = places.flatMap((m, i) => (m.refused === null ? [i] : []));
  const point = new Map(fits.map((member, index) => [member, index]));
  const id = (index: number) => {
    const p = point.get(index);
    return p === undefined ? undefined : provisionalId(p);
  };
  const pairs = [
    ...lanes.map(([a, b]) => [id(a), id(b)] as const),
    ...links.map(([index, system]) => [id(index), system] as const),
  ].flatMap(([a, b]): Pair[] => (a === undefined || b === undefined ? [] : [pairOf(a, b)]));
  const classes = fits.map((i) => places[i].star_class);
  const at = ({ x, y }: Pt): Pt => ({ x, y });
  return {
    points: fits.map((i) => at(places[i])),
    pairs,
    left: [],
    outside: places.filter((m) => m.refused !== null).map(at),
    overlaps: 0,
    crowded: 0,
    capped: false,
    interleaved: null,
    classes: classes.every((c) => c !== null) ? classes : null,
    arranged: null,
  };
}

/**
 * The box in the map area's pixels round what the picker previews: `preview`'s systems, the
 * existing ends of its lanes and the spawn ring round `at`, which the map shows at `anchor` with
 * `perUnit` pixels to a world unit.
 */
export function previewArea(
  preview: ShapePreview | null,
  systems: ReadonlyMap<number, Pt>,
  at: Pt,
  anchor: Pt,
  perUnit: Pt,
): Rect {
  const ends = (preview?.pairs ?? []).flat().flatMap((id) => systems.get(id) ?? []);
  const ring = [-1, 1].flatMap((dx) =>
    [-1, 1].map((dy) => ({ x: at.x + dx * SPAWN_BUFFER, y: at.y + dy * SPAWN_BUFFER })),
  );
  const world = [...(preview?.points ?? []), ...(preview?.outside ?? []), ...ends, ...ring];
  const shown = world.map((p) => ({
    x: anchor.x + (p.x - at.x) * perUnit.x,
    y: anchor.y + (p.y - at.y) * perUnit.y,
  }));
  return boxAround(shown) ?? { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
}
