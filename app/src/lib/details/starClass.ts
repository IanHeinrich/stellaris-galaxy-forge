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
  /** The names of a multiple star's bodies, which its class name alone does not tell apart. */
  note?: string;
}

/** The star bodies of the collapsed remnants: none of them is a star as the picker groups them. */
const EXOTIC_BODIES = new Set(["pc_black_hole", "pc_neutron_star", "pc_pulsar"]);

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
 * star is grouped by how many bodies it has.
 */
function starClassGroup(view: StarClassView): string {
  const count = view.planet_keys.length;
  if (count === 2) return "Binaries";
  if (count === 3) return "Trinaries";
  if (count !== 1) return `${count} stars`;
  const ordinary = view.planet_keys.some((k) => k.endsWith("_star") && !EXOTIC_BODIES.has(k));
  return ordinary ? "Stars" : "Exotic";
}

/** Every localisation key the picker's rows read: each class and each of its bodies. */
export function starClassNameKeys(choices: readonly StarClassView[]): string[] {
  return [...new Set(choices.flatMap((view) => [view.key, ...view.planet_keys]))];
}

/**
 * The picker's rows by star count: single stars before the exotic ones, then binaries, then
 * trinaries, each sorted by name. A multiple star notes its bodies' names.
 */
export function starClassRows(
  choices: readonly StarClassView[],
  label: (key: string) => string,
): StarClassRow[] {
  const rank = (row: StarClassRow) =>
    row.view.planet_keys.length * 2 + (row.group === "Exotic" ? 1 : 0);
  return choices
    .map((view): StarClassRow => {
      const row: StarClassRow = { view, label: label(view.key), group: starClassGroup(view) };
      if (view.planet_keys.length > 1) row.note = view.planet_keys.map(label).join(" + ");
      return row;
    })
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.label.localeCompare(b.label) ||
        (a.note ?? "").localeCompare(b.note ?? ""),
    );
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
