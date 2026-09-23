/** What a save system's star can become, and the edit that makes it so. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import { counted } from "../text";
import { isStarClass } from "./labels";

type Body = Pick<PlanetSummary, "id" | "class">;

export interface StarClassRow {
  view: StarClassView;
  label: string;
  group: string;
}

/** The star bodies of the collapsed remnants: none of them is a star as the picker groups them. */
const EXOTIC_BODIES = new Set(["pc_black_hole", "pc_neutron_star", "pc_pulsar"]);

export const INTERNAL = "Internal";

/** Whether a star body's class is an ordinary `*_star`, not one of the collapsed remnants. */
export function isOrdinaryStarBody(planetClass: string): boolean {
  return planetClass.endsWith("_star") && !EXOTIC_BODIES.has(planetClass);
}

/** Whether a planet class reads as a star body by its key alone, for when no game data says. */
export function looksLikeStarBody(planetClass: string): boolean {
  return planetClass.endsWith("_star") || EXOTIC_BODIES.has(planetClass);
}

/** Every key some class points to as its `crisis_star_class`: the crisis variant of that class. */
export function crisisVariantKeys(starClasses: Iterable<StarClassView>): Set<string> {
  const keys = new Set<string>();
  for (const view of starClasses) {
    if (view.crisis_star_class !== null) keys.add(view.crisis_star_class);
  }
  return keys;
}

/** A class only scripts set that has no name of its own, as mods define by the hundred. */
export function isInternalStarClass(view: StarClassView): boolean {
  return view.spawn_odds === 0 && !view.localised;
}

/** The system's planets whose class is a star, in the order the details list them. */
export function starBodies<P extends Body>(
  planets: readonly P[],
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): P[] {
  return planets.filter((p) => isStarClass(p.class, planetClasses, starClasses));
}

/**
 * The star bodies an edit may be built from, or `null` while the details are unread or `stale`:
 * details read before an edit may predate the system's current class, and matching the new
 * class's planet keys against the old bodies would swap them.
 */
export function currentStarBodies<P extends Body>(
  read: { planets: readonly P[] } | undefined,
  stale: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): P[] | null {
  if (read === undefined || stale) return null;
  return starBodies(read.planets, planetClasses, starClasses);
}

/** The classes a system with `count` star bodies can become: the same count, not `current`. */
export function starClassChoices(
  current: string,
  count: number,
  starClasses: ReadonlyMap<string, StarClassView>,
): StarClassView[] {
  if (count === 0) return [];
  return [...starClasses.values()].filter(
    (c) => c.key !== current && c.planet_keys.length === count,
  );
}

/**
 * A single star is `Exotic` when its body is no ordinary `*_star`, else `Stars`; a multiple
 * star is grouped by how many bodies it has. Classes a new galaxy never rolls group apart, so a
 * crisis variant does not read as a duplicate of its normal class.
 */
function starClassGroup(view: StarClassView, crisisVariants: ReadonlySet<string>): string {
  if (isInternalStarClass(view)) return INTERNAL;
  if (crisisVariants.has(view.key)) return "Crisis variants";
  if (view.spawn_odds === 0) return "Special";
  const count = view.planet_keys.length;
  if (count === 2) return "Binaries";
  if (count === 3) return "Trinaries";
  if (count !== 1) return `${count} stars`;
  return view.planet_keys.some(isOrdinaryStarBody) ? "Stars" : "Exotic";
}

/** Where a group ranks, after the star-count groups: special, crisis variants, then internal. */
function groupRank(row: StarClassRow): number {
  if (row.group === INTERNAL) return 3000;
  if (row.group === "Crisis variants") return 2000;
  if (row.group === "Special") return 1000;
  return row.view.planet_keys.length * 2 + (row.group === "Exotic" ? 1 : 0);
}

/** Every localisation key the picker's rows read: each class and each of its bodies. */
export function starClassNameKeys(choices: readonly StarClassView[]): string[] {
  return [...new Set(choices.flatMap((view) => [view.key, ...view.planet_keys]))];
}

/**
 * The picker's rows by star count: single stars before the exotic ones, then binaries, then
 * trinaries, then the classes a new galaxy never rolls, each sorted by name.
 */
export function starClassRows(
  choices: readonly StarClassView[],
  label: (key: string) => string,
  crisisVariants: ReadonlySet<string>,
): StarClassRow[] {
  return choices
    .map((view): StarClassRow => {
      // Every binary is called "Binary Stars", so a multiple star is named by its bodies.
      const name =
        view.planet_keys.length > 1 ? view.planet_keys.map(label).join(" + ") : label(view.key);
      return { view, label: name, group: starClassGroup(view, crisisVariants) };
    })
    .sort((a, b) => groupRank(a) - groupRank(b) || a.label.localeCompare(b.label));
}

/**
 * `rows` split into what the picker shows and how many stay behind the "Internal" reveal, unless
 * `revealInternal`.
 */
export function visibleStarClassRows(
  rows: readonly StarClassRow[],
  revealInternal: boolean,
): { rows: StarClassRow[]; internalCount: number } {
  const internalCount = rows.filter((row) => row.group === INTERNAL).length;
  const shown = revealInternal ? [...rows] : rows.filter((row) => row.group !== INTERNAL);
  return { rows: shown, internalCount };
}

/**
 * Where each body stands in the current class's `planet_keys`, found by its planet class so a
 * binary stored in another order still lines up. A body whose class matches no free position
 * takes the first position left over, which is list order when the class is unknown.
 */
function positions(bodies: readonly Body[], order: readonly string[]): number[] {
  const n = bodies.length;
  const taken = new Set<number>();
  const matched = bodies.map((body) => {
    const at = order.findIndex((key, i) => i < n && key === body.class && !taken.has(i));
    if (at >= 0) taken.add(at);
    return at;
  });
  const free = Array.from({ length: n }, (_, i) => i).filter((i) => !taken.has(i));
  return matched.map((at) => (at >= 0 ? at : (free.shift() ?? at)));
}

/** The edit that turns `system`'s star into `target`, each star body into its counterpart. */
export function setStarClassOp(
  system: { id: number; star_class: string },
  target: StarClassView,
  bodies: readonly Body[],
  starClasses: ReadonlyMap<string, StarClassView>,
): Op {
  const order = starClasses.get(system.star_class)?.planet_keys ?? [];
  const at = positions(bodies, order);
  return {
    type: "SetStarClass",
    id: system.id,
    class: target.key,
    bodies: bodies.map((body, i) => ({ planet: body.id, class: target.planet_keys[at[i]] })),
  };
}

/** A selected save system for a bulk star class edit, with its star bodies, or `null` unread. */
export interface StarClassTarget {
  system: { id: number; star_class: string };
  bodies: readonly Body[] | null;
}

/** Why a system a bulk star class edit was asked for is left as it is. */
export interface StarClassSkips {
  /** Already the class picked. */
  same: number;
  /** A different number of star bodies from the class picked. */
  stars: number;
  /** No details were read for it. */
  unread: number;
}

export interface StarClassPlan {
  /** One undo step for every system that changes, `null` when none does. */
  op: Op | null;
  changed: number;
  skipped: StarClassSkips;
}

/** The classes any of `targets` can become: those with as many bodies as one of them has stars. */
export function bulkStarClassChoices(
  targets: readonly StarClassTarget[],
  starClasses: ReadonlyMap<string, StarClassView>,
): StarClassView[] {
  const counts = new Set(targets.flatMap((t) => (t.bodies?.length ? [t.bodies.length] : [])));
  return [...starClasses.values()].filter((c) => counts.has(c.planet_keys.length));
}

/** The edit that turns every target with as many stars as `target` has into it. */
export function planStarClass(
  targets: readonly StarClassTarget[],
  target: StarClassView,
  label: string,
  starClasses: ReadonlyMap<string, StarClassView>,
): StarClassPlan {
  const skipped: StarClassSkips = { same: 0, stars: 0, unread: 0 };
  const ops: Op[] = [];
  for (const { system, bodies } of targets) {
    if (bodies === null) skipped.unread++;
    else if (system.star_class === target.key) skipped.same++;
    else if (bodies.length !== target.planet_keys.length) skipped.stars++;
    else ops.push(setStarClassOp(system, target, bodies, starClasses));
  }
  const description = `Set the star class of ${counted(ops.length, "system")} to ${label}`;
  return {
    op: ops.length > 0 ? { type: "Batch", description, ops } : null,
    changed: ops.length,
    skipped,
  };
}

/** What a bulk star class edit left alone and why, or `null` when it left nothing. */
export function skippedNote(skipped: StarClassSkips, label: string): string | null {
  const reasons: [number, string][] = [
    [skipped.stars, "a different number of stars"],
    [skipped.same, `already ${label}`],
    [skipped.unread, "no details read"],
  ];
  const given = reasons.filter(([n]) => n > 0);
  const total = given.reduce((sum, [n]) => sum + n, 0);
  if (total === 0) return null;
  const why =
    given.length === 1 ? given[0][1] : given.map(([n, reason]) => `${reason} (${n})`).join(", ");
  return `${counted(total, "system")} skipped: ${why}`;
}
