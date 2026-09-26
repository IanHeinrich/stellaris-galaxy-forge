/**
 * The class each body of a system is drawn as, resolved from what its source writes, so the
 * system view and the Inspector show the same star for the same body.
 */
import type { DocumentKind } from "../../generated/DocumentKind";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody, singleStarClasses } from "./starBody";

/** A body's class as it is drawn. */
export interface ResolvedClass {
  /** The planet class it is drawn, sized and baked as. */
  planetClass: string;
  star: boolean;
  /** The star class a star is drawn as; null for a planet. */
  starClass: string | null;
  /** The class is a draw: a random class, a planet list or the empire's ideal class. */
  drawn: boolean;
}

/** What resolving a system's classes reads. */
export interface ClassSources {
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
  readonly starClasses: ReadonlyMap<string, StarClassView>;
  readonly kind: DocumentKind | null;
}

let singlesFrom: ReadonlyMap<string, StarClassView> | null = null;
let singles: ReadonlyMap<string, StarClassView> = new Map();

function singlesOf(starClasses: ReadonlyMap<string, StarClassView>) {
  if (starClasses !== singlesFrom) {
    singlesFrom = starClasses;
    singles = singleStarClasses(starClasses);
  }
  return singles;
}

/** A class written in place of a planet class: a random draw, or a list the install does not define. */
function drawnClass(planetClass: string, src: ClassSources): boolean {
  if (planetClass === "random" || planetClass.startsWith("random_")) return true;
  const defined = src.planetClasses.size === 0 || src.planetClasses.has(planetClass);
  return src.kind === "scenario" && !defined;
}

/**
 * Each body's class, in the order the source lists them. A star is drawn as the single-star class
 * of its planet, as a save's is, else as `systemStar`, its system's star class.
 */
export function resolveBodyClasses(
  written: readonly { id: number; class: string }[],
  systemStar: string,
  src: ClassSources,
): Map<number, ResolvedClass> {
  const singles = singlesOf(src.starClasses);
  const resolved = new Map<number, ResolvedClass>();
  for (const { id, class: planetClass } of written) {
    const star = isStarBody(planetClass, src.planetClasses, src.starClasses);
    resolved.set(id, {
      planetClass,
      star,
      starClass: star ? (singles.get(planetClass)?.key ?? systemStar) : null,
      drawn: !star && drawnClass(planetClass, src),
    });
  }
  return resolved;
}
