import type { DocumentKind } from "../../generated/DocumentKind";
import type { StarClassView } from "../../generated/StarClassView";

export interface StarGlyph {
  tint: number;
  /** Nominal radius in screen pixels at the base zoom. */
  size: number;
  /** Draw a faint ring around the core (black holes). */
  ring: boolean;
}

const BASE = 4;

const CLASSES: Array<[prefix: string, glyph: StarGlyph]> = [
  ["sc_black_hole", { tint: 0x1a1020, size: BASE * 1.1, ring: true }],
  ["sc_neutron_star", { tint: 0xbfe0ff, size: BASE * 0.7, ring: false }],
  ["sc_pulsar", { tint: 0xbfe0ff, size: BASE * 0.7, ring: false }],
  ["sc_b", { tint: 0x9fc4ff, size: BASE * 1.2, ring: false }],
  ["sc_a", { tint: 0xf4f6ff, size: BASE * 1.1, ring: false }],
  ["sc_f", { tint: 0xfff4c2, size: BASE, ring: false }],
  ["sc_g", { tint: 0xffe066, size: BASE, ring: false }],
  ["sc_k", { tint: 0xffa64d, size: BASE * 0.9, ring: false }],
  ["sc_m", { tint: 0xff5c4d, size: BASE * 0.8, ring: false }],
];

const MULTI: StarGlyph = { tint: 0xfff0c8, size: BASE * 1.3, ring: false };
const OTHER: StarGlyph = { tint: 0x9aa3ad, size: BASE * 0.9, ring: false };

/** Colour and size for a star class; matched by prefix so modded classes still get a colour. */
export function starGlyph(starClass: string): StarGlyph {
  const sc = starClass.toLowerCase();
  if (sc.includes("binary") || sc.includes("trinary")) return MULTI;
  for (const [prefix, glyph] of CLASSES) {
    if (sc.startsWith(prefix)) return glyph;
  }
  return OTHER;
}

/** The game's own texture for `starClass`, keyed by an exact match in `classes`. */
export function starTextureKey(
  starClass: string,
  classes: ReadonlyMap<string, StarClassView>,
): { key: string; scale: number } | null {
  const view = classes.get(starClass);
  return view ? { key: view.texture_key, scale: view.icon_scale } : null;
}

/** Stands in for "the game picks one" on a scenario system the initializer leaves open. */
export const RANDOM_STAR_CLASS = "sc_g";

/**
 * The class a system's art is chosen by: its own, else the one its initializer gives it, else
 * the stand-in a scenario draws until the game generates the galaxy.
 */
export function effectiveStarClass(
  node: { star_class: string },
  initializerClass: string | undefined,
  kind: DocumentKind | null,
): string {
  if (node.star_class !== "") return node.star_class;
  if (initializerClass?.startsWith("sc_")) return initializerClass;
  return kind === "scenario" ? RANDOM_STAR_CLASS : "";
}
