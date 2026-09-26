/** How large the system view draws each body's disc, in world units. */
import type { PlanetClassView } from "../../generated/PlanetClassView";

/** The vanilla `NGraphics.MOON_SCALE`, used before game data gives its own. */
export const VANILLA_MOON_SCALE = 0.7;
/** World units of disc radius per `planet_size`: Earth (16) is 4.2 at 90 out. */
const DISC_PER_SIZE = 0.26;
/** The size a body is drawn at when its layout gives none, as for a class the install lacks. */
const FALLBACK_SIZE = 10;
/** The smallest disc radius, so a size-0 body still has one to pick and zoom to. */
export const MIN_DISC_RADIUS = 0.5;
/**
 * How much larger an asteroid is drawn than its `planet_size` gives: the game's asteroid model
 * stands out from the belt around it, where a size-5 disc would be lost.
 */
const ASTEROID_SCALE = 2;
/**
 * How much larger a star is drawn than a planet of the same `planet_size`: the game's star mesh
 * is 1.65 times its planet mesh, and its corona adds more. Bodies here are already larger against
 * their orbits than the game draws them, so a star is kept short of its full in-game share.
 */
const STAR_SCALE = 1.8;

/** What a disc is sized by besides its `planet_size`. */
export interface DiscKind {
  moon?: boolean;
  star?: boolean;
  /** The body's planet class, which says whether it is an asteroid or a star drawn as a planet. */
  view?: PlanetClassView;
  /** The install's `NGraphics.MOON_SCALE`; `VANILLA_MOON_SCALE` before game data gives one. */
  moonScale?: number;
}

/** A body's disc radius in world units from its `planet_size`. */
export function discRadius(
  size: number | null,
  { moon, star, view, moonScale }: DiscKind = {},
): number {
  const kind = star && !view?.draws_as_planet ? STAR_SCALE : view?.asteroid ? ASTEROID_SCALE : 1;
  const r =
    (size ?? FALLBACK_SIZE) * DISC_PER_SIZE * (moon ? (moonScale ?? VANILLA_MOON_SCALE) : 1) * kind;
  return Math.max(r, MIN_DISC_RADIUS);
}
