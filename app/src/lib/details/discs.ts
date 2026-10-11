/** How large the system view draws each body's disc, in world units. */
import type { PlanetClassView } from "../../generated/PlanetClassView";

/** The vanilla `NGraphics.MOON_SCALE`, used before game data gives its own. */
export const VANILLA_MOON_SCALE = 0.7;
/** World units of disc radius per `planet_size` for a class with no disc scale of its own. */
const FALLBACK_DISC_PER_SIZE = 0.26;
/** The size a body is drawn at when its layout gives none, as for a class the install lacks. */
const FALLBACK_SIZE = 10;
/** The smallest disc radius, so a size-0 body still has one to pick and zoom to. */
export const MIN_DISC_RADIUS = 0.5;
/**
 * How much larger an asteroid with no disc scale is drawn than its `planet_size` gives: the game's
 * asteroid model stands out from the belt around it, where a size-5 disc would be lost.
 */
const ASTEROID_SCALE = 2;
/**
 * How much larger a star with no disc scale is drawn than a planet of the same `planet_size`: the
 * game's star mesh is 1.65 times its planet mesh, and its corona adds more.
 */
const STAR_SCALE = 1.8;
/**
 * The radius a natural wormhole's vortex is drawn to, in world units: about 1.7 times the largest
 * gas giant's disc (size 30), as its soft rim fades well inside that.
 */
export const WORMHOLE_RADIUS = 14.04;

/** What a disc is sized by besides its `planet_size`. */
export interface DiscKind {
  moon?: boolean;
  star?: boolean;
  /**
   * The body's planet class: its disc scale, or without one whether it is an asteroid or a star
   * drawn as a planet.
   */
  view?: PlanetClassView;
  /** The install's `NGraphics.MOON_SCALE`; `VANILLA_MOON_SCALE` before game data gives one. */
  moonScale?: number;
}

/**
 * A body's disc radius in world units from its `planet_size`: its class's disc scale per size, as
 * the game draws it, or a size rule of the editor's own for a class with none.
 */
export function discRadius(
  size: number | null,
  { moon, star, view, moonScale }: DiscKind = {},
): number {
  const perSize = view?.disc_scale ?? FALLBACK_DISC_PER_SIZE * fallbackKind(star, view);
  const r = (size ?? FALLBACK_SIZE) * perSize * (moon ? (moonScale ?? VANILLA_MOON_SCALE) : 1);
  return Math.max(r, MIN_DISC_RADIUS);
}

function fallbackKind(star: boolean | undefined, view: PlanetClassView | undefined): number {
  if (star && !view?.draws_as_planet) return STAR_SCALE;
  return view?.asteroid ? ASTEROID_SCALE : 1;
}
