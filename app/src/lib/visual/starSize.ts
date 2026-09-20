/**
 * Screen diameter of a game star texture at `icon_scale` 1 and 1 px per world unit: stars grow
 * with the zoom like the game's, slower than the world does (`STAR_ZOOM_POWER`), from a dot no
 * smaller than `MIN_STAR_PX` up to `MAX_STAR_PX`.
 */
export const STAR_BASE_PX = 6.5;
const STAR_ZOOM_POWER = 0.72;
const MIN_STAR_PX = 4;
const MAX_STAR_PX = 56;

/** On-screen diameter of a star drawn `basePx` wide at unit zoom. */
export function starDiameterPx(basePx: number, camScale: number): number {
  const grown = basePx * Math.pow(camScale, STAR_ZOOM_POWER);
  return Math.min(MAX_STAR_PX, Math.max(MIN_STAR_PX, grown));
}
