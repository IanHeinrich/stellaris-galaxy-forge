/**
 * The class each body of a system is drawn as, resolved from what its source writes, so the
 * system view and the Inspector show the same star for the same body.
 */
import type { DocumentKind } from "../../generated/DocumentKind";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { effectiveStarClass } from "../visual/starGlyphs";
import { isStarBody, singleStarClasses, STAR_BODY_CLASS } from "./starBody";

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
  readonly initializerClasses: ReadonlyMap<string, string>;
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

/** The class a system's star is drawn as when its source gives it none. */
function systemStarClass(
  node: { star_class: string; initializer: string } | null,
  src: ClassSources,
): string {
  if (!node) return "";
  return effectiveStarClass(node, src.initializerClasses.get(node.initializer), src.kind);
}

/** A class written in place of a planet class: a random draw, or a list the install does not define. */
function drawnClass(planetClass: string, src: ClassSources): boolean {
  if (planetClass === "random" || planetClass.startsWith("random_")) return true;
  const defined = src.planetClasses.size === 0 || src.planetClasses.has(planetClass);
  return src.kind === "scenario" && !defined;
}

/**
 * Each body's class, in the order the source lists them. A scenario writes a star as the bare
 * `star`, or as the system's star class, and each such star takes the class's next planet. A
 * star is drawn as the single-star class of its planet, as a save's is.
 */
export function resolveBodyClasses(
  written: readonly { id: number; class: string }[],
  node: { star_class: string; initializer: string } | null,
  src: ClassSources,
): Map<number, ResolvedClass> {
  const system = systemStarClass(node, src);
  const singles = singlesOf(src.starClasses);
  const resolved = new Map<number, ResolvedClass>();
  let nth = 0;
  for (const { id, class: planetClass } of written) {
    const named = src.starClasses.has(planetClass) && !src.planetClasses.has(planetClass);
    const asStarClass = planetClass === STAR_BODY_CLASS ? system : named ? planetClass : null;
    let surface = planetClass;
    if (asStarClass !== null) {
      const keys = src.starClasses.get(asStarClass)?.planet_keys ?? [];
      surface = keys[nth] ?? keys[0] ?? planetClass;
      nth++;
    }
    const star = asStarClass !== null || isStarBody(surface, src.planetClasses, src.starClasses);
    resolved.set(id, {
      planetClass: surface,
      star,
      starClass: star ? (singles.get(surface)?.key ?? asStarClass ?? system) : null,
      drawn: !star && drawnClass(planetClass, src),
    });
  }
  return resolved;
}
