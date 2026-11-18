/**
 * Where a scenario's ambient objects stand. The game and the core measure an object's point from
 * the system's main star, which stands off the centre in a binary; the scene, the drag and the
 * pages measure from the system's centre.
 */
import type { AmbientObject } from "../../generated/AmbientObject";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemLayout } from "./orbits";

type Point = { x: number; y: number };

/** The ambient objects a system's details list: the initializer's, then the scenario's own. */
export function ambientObjectsOf(
  details: SystemDetails | null | undefined,
): readonly AmbientObject[] {
  return details?.spawn?.ambient_objects ?? [];
}

/** Where the system's main star, its details' first body, is drawn; the centre without one. */
export function mainStarPoint(layout: SystemLayout, details: SystemDetails | null): Point {
  const id = details?.planets.find((p) => p.role === "primary")?.id;
  const star = layout.bodies.find((b) => b.id === id);
  return star ? { x: star.x, y: star.y } : { x: 0, y: 0 };
}

/**
 * `at` about the system's centre measured from the main star at `star`, as an ambient object op
 * takes it; or, `back`, a point measured from the main star as the centre measures it.
 */
export function aboutMainStar(at: Point, star: Point, back = false): Point {
  const sign = back ? 1 : -1;
  return { x: at.x + sign * star.x, y: at.y + sign * star.y };
}

/** Where `object` stands about the centre, with the main star at `star`; null for one at no point. */
export function ambientObjectPoint(object: AmbientObject, star: Point): Point | null {
  return object.place.place === "point" ? aboutMainStar(object.place, star, true) : null;
}
