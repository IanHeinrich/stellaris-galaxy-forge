/** What one star body of a save system can become, and whether its system's class still fits. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import { isStarClass } from "./labels";
import { isOrdinaryStarBody, looksLikeStarBody } from "./starClass";

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

/** Whether a body is a star: as the game data says, or by its key while none is loaded. */
export function isStarBody(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  if (planetClasses.size === 0) return looksLikeStarBody(planetClass);
  return isStarClass(planetClass, planetClasses, starClasses);
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
    .map((key) => ({ key, label: label(key), group: isOrdinaryStarBody(key) ? "Stars" : "Exotic" }))
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
  const sorted = (keys: readonly string[]) => [...keys].sort().join("|");
  const want = sorted(bodies);
  const fits = [...starClasses.values()].filter((c) => sorted(c.planet_keys) === want);
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
  const sorted = (keys: readonly string[]) => [...keys].sort().join("|");
  return sorted(bodies) === sorted(starClass.planet_keys) ? null : [...bodies];
}
