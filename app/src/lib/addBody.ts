import type { BodyClassPick } from "../generated/BodyClassPick";
import type { PlanetSummary } from "../generated/PlanetSummary";

export const ADD_PLANET_LABEL = "Add planet here";
export const ADD_MOON_LABEL = "Add moon";
export const RANDOM_BODY_LABEL = "Random";
export const BODIES_NEED_GAME_DATA = "Load game data to add a planet or moon.";

/** `10–25`, the sizes a random body of the class is drawn from. */
export function sizeRange(pick: BodyClassPick): string {
  return pick.min_size === pick.max_size ? `${pick.min_size}` : `${pick.min_size}–${pick.max_size}`;
}

/**
 * Whether `planet` may take a new moon: a planet that orbits the primary or a companion star,
 * not a moon, a star or an asteroid. A habitat about a planet has no moon bit but takes none.
 */
export function takesMoons(
  planet: PlanetSummary,
  parent: PlanetSummary | undefined,
  { star, asteroid }: { star: boolean; asteroid: boolean },
): boolean {
  const aboutAStar =
    planet.parent === null || parent?.role === "star" || parent?.role === "primary";
  return !planet.moon && !star && !asteroid && aboutAStar;
}
