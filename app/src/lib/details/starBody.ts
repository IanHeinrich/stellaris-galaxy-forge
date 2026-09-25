/** What one star body of a save system can become, and whether its system's class still fits. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";

export interface FoundPlanet {
  system: number;
  planet: PlanetSummary;
}

export interface StarTypeRow {
  key: string;
  label: string;
  group: string;
}

/** Planet `id` and the system it is in, from whichever system's read details list it. */
export function findPlanet(
  details: ReadonlyMap<number, SystemDetails>,
  id: number,
): FoundPlanet | null {
  for (const read of details.values()) {
    const planet = read.planets.find((p) => p.id === id);
    if (planet) return { system: read.id, planet };
  }
  return null;
}

/** The class an initializer writes for the body standing in for the system's own star. */
export const STAR_BODY_CLASS = "star";

/** The star bodies of the collapsed remnants: none of them is a star as the pickers group them. */
const EXOTIC_BODIES = new Set(["pc_black_hole", "pc_neutron_star", "pc_pulsar"]);

/** Whether a star body's class is an ordinary `*_star`, not one of the collapsed remnants. */
function isOrdinaryStarBody(planetClass: string): boolean {
  return planetClass.endsWith("_star") && !EXOTIC_BODIES.has(planetClass);
}

/** The group a star body's class sits in on a picker. */
export function starGroup(planetClass: string): "Stars" | "Exotic" {
  return isOrdinaryStarBody(planetClass) ? "Stars" : "Exotic";
}

/**
 * Whether a body is a star: the bare `star` an initializer writes, a planet class the game flags
 * `star` or a `star_classes` key, and by its key alone while no game data is loaded.
 */
export function isStarBody(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  if (planetClass === STAR_BODY_CLASS) return true;
  if (planetClasses.size === 0) {
    return planetClass.endsWith("_star") || EXOTIC_BODIES.has(planetClass);
  }
  return planetClasses.get(planetClass)?.star ?? starClasses.has(planetClass);
}

/** Whether a body's page has star fields to edit: a star, where the document's bodies can change. */
export function starBodyEditable(
  planetClass: string,
  bodies: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  return bodies && isStarBody(planetClass, planetClasses, starClasses);
}

/** Whether two lists hold the same classes, in any order. */
export function sameBodies(a: readonly string[], b: readonly string[]): boolean {
  const sorted = (keys: readonly string[]) => [...keys].sort().join("|");
  return sorted(a) === sorted(b);
}

/** The planet classes a star body can become: every one the game flags `star`, not `current`. */
export function starTypeChoices(
  current: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): string[] {
  return [...planetClasses.values()].filter((c) => c.star && c.key !== current).map((c) => c.key);
}

/** The picker's rows: ordinary stars before the exotic bodies, each group sorted by name. */
export function starTypeRows(
  choices: readonly string[],
  label: (key: string) => string,
): StarTypeRow[] {
  const exotic = (row: StarTypeRow) => (row.group === "Exotic" ? 1 : 0);
  return choices
    .map((key) => ({ key, label: label(key), group: starGroup(key) }))
    .sort((a, b) => exotic(a) - exotic(b) || a.label.localeCompare(b.label));
}

/**
 * The star class each planet class makes on its own, by planet class: the one whose only body it
 * is, preferring a class a new galaxy rolls over a crisis or scripted variant.
 */
export function singleStarClasses(
  starClasses: ReadonlyMap<string, StarClassView>,
): Map<string, StarClassView> {
  const singles = new Map<string, StarClassView>();
  for (const view of starClasses.values()) {
    if (view.planet_keys.length !== 1) continue;
    const body = view.planet_keys[0];
    const held = singles.get(body);
    if (held === undefined || (held.spawn_odds === 0 && view.spawn_odds > 0)) {
      singles.set(body, view);
    }
  }
  return singles;
}

/**
 * The class whose stars are exactly `bodies`, in any order: `current` when it fits, else one a new
 * galaxy rolls, else any; `null` when no class has them.
 */
export function classForBodies(
  bodies: readonly string[],
  current: string,
  starClasses: ReadonlyMap<string, StarClassView>,
): string | null {
  const fits = [...starClasses.values()].filter((c) => sameBodies(c.planet_keys, bodies));
  const pick = fits.find((c) => c.key === current) ?? fits.find((c) => c.spawn_odds > 0) ?? fits[0];
  return pick?.key ?? null;
}

/**
 * The edit that turns star body `body` into `planetClass`. The system's star class, which draws
 * its map icon and applies its modifier, follows when some class has the stars it leaves.
 */
export function setStarTypeOp(
  system: { id: number; star_class: string },
  bodies: readonly { id: number; class: string }[],
  body: number,
  planetClass: string,
  starClasses: ReadonlyMap<string, StarClassView>,
): Op {
  const next = bodies.map((b) => (b.id === body ? planetClass : b.class));
  return {
    type: "SetStarClass",
    id: system.id,
    class: classForBodies(next, system.star_class, starClasses) ?? system.star_class,
    bodies: [{ planet: body, class: planetClass }],
  };
}

/** The edit that gives planet `id` `size`, or `null` for a size under 1, fractional or unchanged. */
export function setPlanetSizeOp(id: number, current: number, size: number): Op | null {
  if (!Number.isInteger(size) || size < 1 || size === current) return null;
  return { type: "SetPlanetSize", id, size };
}

/**
 * The star bodies' classes when they are not the class's `planet_keys` in any order, or `null`
 * when they are, when there are none, or when the install does not know the class.
 */
export function starMismatch(
  bodies: readonly string[],
  starClass: StarClassView | undefined,
): string[] | null {
  if (starClass === undefined || bodies.length === 0) return null;
  return sameBodies(bodies, starClass.planet_keys) ? null : [...bodies];
}
