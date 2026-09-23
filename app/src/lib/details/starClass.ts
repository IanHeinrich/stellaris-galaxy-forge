/** What a save system's star can become, and the edit that makes it so. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarClass } from "./labels";

type Body = Pick<PlanetSummary, "id" | "class">;

export type StarClassGroup = "Stars" | "Exotic";

export interface StarClassRow {
  view: StarClassView;
  label: string;
  group: StarClassGroup;
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

/** `Exotic` for a class none of whose bodies is an ordinary `*_star`, else `Stars`. */
export function starClassGroup(view: StarClassView): StarClassGroup {
  const ordinary = view.planet_keys.some((k) => k.endsWith("_star") && !EXOTIC_BODIES.has(k));
  return ordinary ? "Stars" : "Exotic";
}

/** The picker's rows: the stars, then the exotic classes, each sorted by name. */
export function starClassRows(
  choices: readonly StarClassView[],
  label: (key: string) => string,
): StarClassRow[] {
  const rank = (group: StarClassGroup) => (group === "Stars" ? 0 : 1);
  return choices
    .map((view) => ({ view, label: label(view.key), group: starClassGroup(view) }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.label.localeCompare(b.label));
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
