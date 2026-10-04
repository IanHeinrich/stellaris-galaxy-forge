/** Whether a save body's page offers its ring, and the edit that gives or takes one. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody } from "./starBody";

/**
 * Whether a body's page shows the Ring checkbox: any body but a star, an asteroid or a ring world
 * segment, read by its key alone while no game data is loaded.
 */
export function hasRingCheckbox(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  if (isStarBody(planetClass, planetClasses, starClasses)) return false;
  if (planetClasses.size === 0) {
    return !planetClass.includes("asteroid") && !planetClass.includes("ringworld");
  }
  const view = planetClasses.get(planetClass);
  return view?.asteroid !== true && view?.ringworld !== true;
}

/** The edit that gives planet `planet` a ring, or takes it off. */
export function setPlanetRingOp(planet: number, ring: boolean): Op {
  return { type: "SetBodyRing", body: planet, ring };
}
