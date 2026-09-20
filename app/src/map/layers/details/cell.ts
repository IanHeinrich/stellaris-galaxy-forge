import type { Texture } from "pixi.js";
import { NAME_ROW, PLANET_STACK, nameRowY, plateBottom } from "../../../lib/details/layout";
import { MAP_FONT } from "../../../lib/visual/style";

export const ICON_PX = NAME_ROW.iconPx;
/** The dark disc under each row icon, ringed by its category. */
export const DISC_PX = ICON_PX + 4;
export const GLYPH_STYLE = { fontFamily: MAP_FONT, fontSize: 16, fill: 0xd6dde8 };
export const PLANET_PX = ICON_PX;
export const PLANET_Y = -PLANET_PX / 2;
export const PLANET_DX = PLANET_STACK.stride;

/** The name row's vertical offsets, derived per layout from the star's on-screen size. */
export interface RowY {
  row: number;
  icon: number;
  disc: number;
  resource: number;
}

/** The row's vertical offsets for this layout pass, following the star's on-screen size. */
export function rowY(camScale: number): RowY {
  const row = nameRowY(camScale);
  const icon = row + (NAME_ROW.height - ICON_PX) / 2;
  return {
    row,
    icon,
    disc: icon - (DISC_PX - ICON_PX) / 2,
    resource: plateBottom(row) + 2,
  };
}

/** The textures a row draws with, each queued by the layer when it asks for one it has not got. */
export interface Textures {
  /** The texture for `key` when it has landed; `undefined` while it loads, `null` when none can. */
  texture(key: string): Texture | null | undefined;
  /** The first of `keys` that rendered; `undefined` while any is still loading, `null` when none can. */
  resolve(keys: string[]): Texture | null | undefined;
}
