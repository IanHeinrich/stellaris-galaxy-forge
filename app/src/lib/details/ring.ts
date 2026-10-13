/** Whether a save body's page offers its ring. */
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody } from "./starBody";

/** What the Ring checkbox reads of a body. */
export interface RingBody {
  class: string;
  moon: boolean;
  /** Whether it has a ring now. */
  ring: boolean;
}

/**
 * Whether a body's page shows the Ring checkbox: any body but a star, an asteroid or a ring world
 * segment, read by its key alone while no game data is loaded. A moon shows it only while it has
 * a ring, to take it off: the game draws no ring round a moon.
 */
export function hasRingCheckbox(
  body: RingBody,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  if (body.moon && !body.ring) return false;
  if (isStarBody(body.class, planetClasses, starClasses)) return false;
  if (planetClasses.size === 0) {
    return !body.class.includes("asteroid") && !body.class.includes("ringworld");
  }
  const view = planetClasses.get(body.class);
  return view?.asteroid !== true && view?.ringworld !== true;
}
