/**
 * How the system view draws a class, read from its key once the scene has resolved which class a
 * body is. The layers draw from what this gives and never from a key.
 */
import type { StarClassView } from "../../generated/StarClassView";
import { planetTint, shatteredDiscKey } from "../../lib/details/icons";
import { starFlare, starGlyph, type StarFlare } from "../../lib/visual/starGlyphs";

export const ICY_TINT = 0xbfd9ee;

const NO_STAR_CLASSES: ReadonlyMap<string, StarClassView> = new Map();

/**
 * A tint for each class family `planetTint` leaves to its neutral grey; every other class takes
 * the tint `planetTint` gives it on the galaxy map.
 */
const FAMILY_TINTS: Array<[pattern: RegExp, tint: number]> = [
  [/gas_giant/, 0xc9a26b],
  [/asteroid/, 0x8a8178],
  [/barren/, 0x8c8279],
  [/frozen/, 0xcfe3f0],
  [/toxic/, 0x9bc34a],
  [/molten/, 0xd9623b],
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
  /**
   * Texture keys for its surface baked as a disc, the first that renders drawn: its model's, then
   * its class's. None for a black hole, a draw or an irregular body.
   */
  readonly surfaceKeys: readonly string[];
  /** Drawn black with its swirl behind it, where every other star shines. */
  readonly blackHole: boolean;
  /** The light a pulsar or a neutron star throws off its poles. */
  readonly flare: StarFlare | null;
  /** Its icon is its own outline, an asteroid's rock or an astral scar's glow: no round shading. */
  readonly irregular: boolean;
  /**
   * Drawn from its icon alone, as the install has no surface to bake into a disc: a habitat, a
   * ring world segment, a broken world or a class whose model draws nothing. Its icon is never
   * blown up far past its own pixels, and a glow behind it keeps it reading as a body when small.
   */
  readonly flat: boolean;
  /** Its surface broken into shards, as the game's model of a shattered world is. */
  readonly shattered: boolean;
  /** Light on a black ground, added as a star's art is: an astral scar. */
  readonly luminous: boolean;
  /** A hard surface that catches a highlight; a gas giant has none. */
  readonly gloss: boolean;
  /** The colour its icon is glazed over itself in, or null. */
  readonly glaze: number | null;
  /**
   * The texture key of the game model drawn in place of its disc, at the model's own size: a
   * habitat's or a ring world segment's. Its disc and icon show while the model bakes or where it
   * cannot, unless `waitsForModel`. Null for any other body.
   */
  readonly model: string | null;
  /**
   * Nothing of it is drawn while its model bakes: a ring world segment, whose disc would stand
   * in unturned. Its disc and icon still show where the model cannot be baked.
   */
  readonly waitsForModel: boolean;
}

function classTint(
  planetClass: string,
  starClass: string | null,
  starClasses: ReadonlyMap<string, StarClassView>,
): number {
  if (starClass !== null) return starGlyph(starClass, starClasses).tint;
  for (const [pattern, tint] of FAMILY_TINTS) {
    if (pattern.test(planetClass)) return tint;
  }
  return planetTint(planetClass);
}

/** What `bodyLook` reads of a body. */
export interface LookOf {
  readonly planetClass: string;
  /** The star class a star is drawn as; null for a planet. */
  readonly starClass: string | null;
  /** The install's star classes, which say how many stars `starClass` has. */
  readonly starClasses?: ReadonlyMap<string, StarClassView>;
  /** Its class is left to a draw, with no surface of its own. */
  readonly drawn: boolean;
  /** The install draws its class from its icon alone. */
  readonly flat?: boolean;
  /** Its class's model draws nothing, so it is drawn from its icon alone too. */
  readonly hidden?: boolean;
  /** Its class is an asteroid, as the install's class says. */
  readonly asteroid?: boolean;
  /** The model the save names for it. */
  readonly model?: string | null;
  /** What breaks a shattered class apart: the planet's id. */
  readonly shatterSeed?: number | null;
  /** The texture key of the model drawn in place of its disc. */
  readonly bodyModel?: string | null;
  /** Its model is a ring world segment's, which nothing stands in for while it bakes. */
  readonly segment?: boolean;
}

/**
 * How a body of `planetClass` is drawn: a star as `starClass`, a body whose class is left to a
 * draw with no surface of its own, and a `flat` or `hidden` class or an asteroid from its icon
 * alone. A planet whose save names a `model` shows that model's surface where the install has
 * one, else its class's. A class the install draws broken apart shows its shattered disc, broken as
 * `shatterSeed`, the planet's id, says, so each planet breaks its own way and always the same way.
 */
export function bodyLook({
  planetClass,
  starClass,
  starClasses = NO_STAR_CLASSES,
  drawn,
  flat = false,
  hidden = false,
  asteroid = false,
  model = null,
  shatterSeed = null,
  bodyModel = null,
  segment = false,
}: LookOf): BodyLook {
  const blackHole = starClass !== null && starGlyph(starClass, starClasses).ring;
  const luminous = /astral_scar/.test(planetClass);
  const flatArt = (flat || hidden) && starClass === null && !drawn && !luminous;
  const irregular = asteroid || luminous || flatArt;
  const baked = !blackHole && !drawn && !irregular;
  const kind = starClass !== null ? "star_disc" : "planet_disc";
  const seed = starClass === null && baked ? shatterSeed : null;
  const shattered = seed !== null;
  const modelKeys = model !== null && starClass === null ? [`planet_model:${model}`] : [];
  const shownModel = starClass === null && !drawn ? bodyModel : null;
  const keys =
    seed !== null
      ? [shatteredDiscKey(planetClass, seed)]
      : [...modelKeys, `${kind}:${planetClass}`];
  return {
    tint: classTint(planetClass, starClass, starClasses),
    surfaceKeys: baked ? keys : [],
    blackHole,
    flare: starClass !== null ? starFlare(starClass) : null,
    irregular,
    flat: flatArt,
    shattered,
    luminous,
    gloss: !/gas_giant/.test(planetClass),
    glaze: ASTEROID_GLAZES.find(([pattern]) => pattern.test(planetClass))?.[1] ?? null,
    model: shownModel,
    waitsForModel: shownModel !== null && segment,
  };
}
