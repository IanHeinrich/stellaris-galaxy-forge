/**
 * How the system view draws a class, read from its key once the scene has resolved which class a
 * body is. The layers draw from what this gives and never from a key.
 */
import { planetTint } from "../../lib/details/icons";
import { starFlare, starGlyph, type StarFlare } from "../../lib/visual/starGlyphs";

export const ICY_TINT = 0xbfd9ee;
const ROCKY_TINT = 0x9a8773;
const DEBRIS_TINT = 0x514a45;

/** The tint of a belt's rocks, by its kind. */
export function beltTint(kind: string): number {
  if (kind.includes("icy")) return ICY_TINT;
  if (kind.includes("rocky")) return ROCKY_TINT;
  return DEBRIS_TINT;
}

/** The class families `planetTint` leaves to its neutral grey, by the colour the scene gives each. */
const FAMILY_TINTS: Array<[pattern: RegExp, tint: number]> = [
  [/gas_giant/, 0xc9a26b],
  [/asteroid/, 0x8a8178],
  [/barren/, 0x8c8279],
  [/frozen/, 0xcfe3f0],
  [/toxic/, 0x9bc34a],
  [/molten/, 0xd9623b],
  [/ocean/, 0x3a7fd0],
  [/continental/, 0x4f9d5a],
  [/tropical/, 0x3fae6b],
  [/arid/, 0xd09a4e],
  [/desert/, 0xe0bf7a],
  [/savannah/, 0xb9b25a],
  [/tundra/, 0xa7b9a0],
  [/alpine/, 0xd8e4ea],
  [/arctic/, 0xe6f0f7],
];

/**
 * The game's asteroid kinds share one icon and differ only in their models; a glaze of the icon
 * added over itself in the kind's colour tells them apart.
 */
const ASTEROID_GLAZES: Array<[RegExp, number]> = [
  [/ice_asteroid/, ICY_TINT],
  [/crystal_asteroid/, 0xd9b3ff],
];

/** How one body is drawn. */
export interface BodyLook {
  /** The disc's colour until its surface or icon lands, and its glow's, outline's and ring's. */
  readonly tint: number;
  /** The texture key of its surface baked as a disc; null for a black hole, a draw or an irregular body. */
  readonly surfaceKey: string | null;
  /** Drawn black with its swirl behind it, where every other star shines. */
  readonly blackHole: boolean;
  /** The light a pulsar or a neutron star throws off its poles. */
  readonly flare: StarFlare | null;
  /** Its icon is its own outline, an asteroid's rock or an astral scar's glow: no round shading. */
  readonly irregular: boolean;
  /** Light on a black ground, added as a star's art is: an astral scar. */
  readonly luminous: boolean;
  /** A hard surface that catches a highlight; a gas giant has none. */
  readonly gloss: boolean;
  /** The colour its icon is glazed over itself in, or null. */
  readonly glaze: number | null;
}

function classTint(planetClass: string, starClass: string | null): number {
  if (starClass !== null) return starGlyph(starClass).tint;
  for (const [pattern, tint] of FAMILY_TINTS) {
    if (pattern.test(planetClass)) return tint;
  }
  return planetTint(planetClass);
}

/**
 * How a body of `planetClass` is drawn: a star as `starClass`, and a body whose class is left to
 * a draw with no surface of its own.
 */
export function bodyLook(planetClass: string, starClass: string | null, drawn: boolean): BodyLook {
  const blackHole = starClass !== null && starGlyph(starClass).ring;
  const luminous = /astral_scar/.test(planetClass);
  const irregular = /asteroid/.test(planetClass) || luminous;
  const baked = !blackHole && !drawn && !irregular;
  const kind = starClass !== null ? "star_disc" : "planet_disc";
  return {
    tint: classTint(planetClass, starClass),
    surfaceKey: baked ? `${kind}:${planetClass}` : null,
    blackHole,
    flare: starClass !== null ? starFlare(starClass) : null,
    irregular,
    luminous,
    gloss: !/gas_giant/.test(planetClass),
    glaze: ASTEROID_GLAZES.find(([pattern]) => pattern.test(planetClass))?.[1] ?? null,
  };
}
