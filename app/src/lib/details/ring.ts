/** Whether a save body's page offers its ring. */
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { isRingSegmentClass } from "./ringWorldRemoval";
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
 * segment, read by its key alone for a class the install does not define. A moon shows it only
 * while it has a ring, to take it off: the game draws no ring round a moon.
 */
export function hasRingCheckbox(
  body: RingBody,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): boolean {
  if (body.moon && !body.ring) return false;
  if (isStarBody(body.class, planetClasses, starClasses)) return false;
  const view = planetClasses.get(body.class);
  const asteroid = view === undefined ? body.class.includes("asteroid") : view.asteroid === true;
  return !asteroid && !isRingSegmentClass(body.class, planetClasses);
}
