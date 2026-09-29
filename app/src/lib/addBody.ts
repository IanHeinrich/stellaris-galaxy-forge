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

/** Whether `planet` may take a new moon: a planet, not a moon, a star or an asteroid. */
export function takesMoons(
  planet: PlanetSummary,
  { star, asteroid }: { star: boolean; asteroid: boolean },
): boolean {
  return !planet.moon && !star && !asteroid;
}
