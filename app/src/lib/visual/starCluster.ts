import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemBody } from "../../generated/SystemBody";
import { isStarBody } from "../details/starBody";

/** One star of a multiple system, placed in units of the footprint one single star's glyph takes. */
export interface ClusterStar {
  /** The texture key and its `icon_scale`, as `starTextureKey` gives for a single star. */
  texture: { key: string; scale: number };
  /** Centre offset from the system's position, in footprints; y grows downward. */
  dx: number;
  dy: number;
  /** Diameter before `texture.scale`, in footprints. */
  diameter: number;
}

/** The planet size a star body is drawn at its cluster's base diameter for: a G star is 25–29. */
export const REFERENCE_STAR_SIZE = 27;
export const MIN_SIZE_FACTOR = 0.7;
export const MAX_SIZE_FACTOR = 1.35;

/** How much bigger than its cluster's base a star body of `size` draws, held to the clamps. */
export function starSizeFactor(size: number | null): number {
  if (size === null || size <= 0) return 1;
  return Math.min(MAX_SIZE_FACTOR, Math.max(MIN_SIZE_FACTOR, size / REFERENCE_STAR_SIZE));
}

/**
 * Where each of `count` stars sits, in footprints, with the diameter they share: two on a
 * diagonal, upper left to lower right; three or more on a ring from the top, clockwise.
 */
export function clusterOffsets(count: number): { dx: number; dy: number; diameter: number }[] {
  if (count < 2) return [{ dx: 0, dy: 0, diameter: 1 }];
  const diameter = count === 2 ? 0.55 : Math.min(0.5, 1.5 / count);
  const radius = (1 - diameter) / 2;
  const start = count === 2 ? (-3 * Math.PI) / 4 : -Math.PI / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = start + (i * 2 * Math.PI) / count;
    return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle), diameter };
  });
}

/**
 * A save system's star bodies drawn one by one, or `null` when it has fewer than two and draws
 * as its class. Each star takes the single-star class of its planet class from `singles`, else
 * `fallback`, the system class's own texture; `null` when neither gives one.
 */
export function starCluster(
  bodies: readonly SystemBody[] | undefined,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
  singles: ReadonlyMap<string, StarClassView>,
  fallback: { key: string; scale: number } | null,
): ClusterStar[] | null {
  const stars = (bodies ?? []).filter((b) => isStarBody(b.class, planetClasses, starClasses));
  if (stars.length < 2) return null;
  const places = clusterOffsets(stars.length);
  const cluster: ClusterStar[] = [];
  for (const [i, body] of stars.entries()) {
    const single = singles.get(body.class);
    const texture = single ? { key: single.texture_key, scale: single.icon_scale } : fallback;
    if (texture === null) return null;
    const place = places[i];
    cluster.push({
      texture,
      dx: place.dx,
      dy: place.dy,
      diameter: place.diameter * starSizeFactor(body.size),
    });
  }
  return cluster;
}
