/** The texture keys, frames and tints the details bar and the map's badges draw with. */
import type { BypassView } from "../../generated/BypassView";

/** Frames of `GFX_fleet_presence_icons`: the bright yellow, blue and red upright chevrons. */
export const FLEET_ICON_KEY = "sprite:GFX_fleet_presence_icons#10";
export const FAUNA_FLEET_ICON_KEY = "sprite:GFX_fleet_presence_icons#11";
export const HOSTILE_FLEET_ICON_KEY = "sprite:GFX_fleet_presence_icons#12";
export const ARCHAEOLOGY_ICON_KEYS = [
  "sprite:GFX_archaeology_map_icon",
  "sprite:GFX_icon_archaeology",
];
export const PRE_FTL_ICON_KEY = "sprite:GFX_firstcontact_icon";
/** The ring-with-structure frame of the ship-class sheet, the game's map glyph for a megastructure. */
export const MEGASTRUCTURE_ICON_KEY = "sprite:GFX_ship_class_small#22";
/** The name plate the game draws behind the owner flag and name of a colonised system. */
export const PLATE_KEY = "sprite:GFX_map_icon_bg";
export const CAPITAL_PLATE_KEY = "sprite:GFX_map_icon_bg_capital";
/** Horizontal fade of the plate texture, in pixels, kept unstretched at both ends. */
export const PLATE_BORDER_PX = 15;

/** The game's planet-size glyph, shown before the size when the texture has landed. */
export const PLANET_SIZE_ICON_KEY = "sprite:GFX_text_planetsize";

/**
 * The game colours `GFX_colonizability` by the player species' habitability; an editor has no
 * species, so every habitable planet gets the neutral blue-grey frame.
 */
const HABITABLE_FRAME = 7;

/** The shadowed frame the game's star icon uses, then the plain sheet. */
export const PLANET_ICON_KEYS = [
  `sprite:GFX_colonizability_shadow#${HABITABLE_FRAME}`,
  `sprite:GFX_colonizability#${HABITABLE_FRAME}`,
];

const PLANET_TINTS: Array<[pattern: RegExp, tint: number]> = [
  [/continental|ocean|tropical/, 0x4fa3d9],
  [/arid|desert|savannah/, 0xd9a55b],
  [/alpine|arctic|tundra/, 0xbfe0ff],
  [/gaia|^random_(colonizable|ruler|non_machine|non_ideal)$|^ideal_planet_class$/, 0x5fd36b],
  [/nuked|relic|city|habitat|ringworld|shattered_ring/, 0xa0a8b3],
];
const PLANET_TINT_OTHER = 0x6b7280;

export function planetTint(planetClass: string): number {
  for (const [pattern, tint] of PLANET_TINTS) {
    if (pattern.test(planetClass)) return tint;
  }
  return PLANET_TINT_OTHER;
}

/**
 * The ring the game frames a map icon with: white segments for an owner-built starbase, dashed
 * green for a bypass that moves you somewhere (an L-Gate on a dark red disc), solid blue for
 * everything that merely exists in the system.
 */
export type IconFrame = "station" | "bypass" | "lgate" | "poi";

export interface Icon {
  /** Texture keys to try in order; the first that renders is drawn. */
  keys: string[];
  /** Drawn when no key renders. */
  glyph: string;
  label: string;
  frame: IconFrame;
}

/** Bypass kind → what `common/bypass` says about it. */
export type BypassKinds = ReadonlyMap<string, BypassView>;

/** The vanilla `icon_frame` of each bypass kind, for when the game's definitions are not loaded. */
const BYPASS_FRAMES: Record<string, number> = {
  gateway: 25,
  gateway_ness: 25,
  quantum_catapult: 25,
  shroud_tunnel: 25,
  wormhole: 12,
  strange_wormhole: 12,
  entropy_wormhole: 12,
  starlit_wormhole: 59,
  lgate: 30,
  relay_bypass: 30,
};

/**
 * The game's map glyph for a bypass kind, shared by the details row and the map's badges; a
 * loaded definition with no icon of its own has none, and only an unknown kind falls back.
 */
export function bypassIconKey(kind: string, kinds?: BypassKinds): string | null {
  const defined = kinds?.get(kind);
  const frame = defined ? defined.icon_frame : (BYPASS_FRAMES[kind] ?? BYPASS_FRAMES.gateway);
  return frame === null ? null : `sprite:GFX_ship_class_small#${frame}`;
}
