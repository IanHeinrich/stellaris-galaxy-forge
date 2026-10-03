import { DEFAULT_SYSTEM_HEIGHT } from "../generated/constants";

/** Heights closer to flat than this read as flat. */
export const FLAT_EPSILON = 0.01;

/** The height the editor shows: 0 is the game's default plane, above it rises. */
export function relativeHeight(absolute: number | null | undefined): number {
  return absolute == null ? 0 : absolute - DEFAULT_SYSTEM_HEIGHT;
}

/** The `visual_height` a shown height is written as. */
export function absoluteHeight(relative: number): number {
  return relative + DEFAULT_SYSTEM_HEIGHT;
}

export function isFlat(relative: number): boolean {
  return Math.abs(relative) < FLAT_EPSILON;
}

const ABOVE = 0xef9f27;
const FLAT = 0xc8c6bd;
const BELOW = 0x378add;

/** The colour a shown height reads as: blue below the plane, neutral on it, amber above. */
export function heightTint(relative: number): number {
  if (isFlat(relative)) return FLAT;
  return relative > 0 ? ABOVE : BELOW;
}

/** How strongly a height shows, 0 at flat to 1 at `full` or beyond. */
export function heightStrength(relative: number, full = 100): number {
  return Math.min(1, Math.abs(relative) / full);
}

/** How far the inspector's Height slider reaches either side of the plane; the field takes any height. */
export const HEIGHT_SLIDER_MAX = 500;

/** A shown height to the 0.1 the slider and the map write it to. */
export function roundHeight(relative: number): number {
  return Math.round(relative * 10) / 10 || 0;
}

/**
 * The shown height at slider position `t`, from -1 to 1: a signed cube, so the middle of the track
 * moves in fractions of a unit and the ends still reach `HEIGHT_SLIDER_MAX`.
 */
export function sliderToHeight(t: number): number {
  const clamped = Math.max(-1, Math.min(1, t));
  return Math.sign(clamped) * HEIGHT_SLIDER_MAX * Math.abs(clamped) ** 3;
}

/** The slider position from -1 to 1 that shows `relative`, held at the ends beyond the reach. */
export function heightToSlider(relative: number): number {
  const t = Math.cbrt(Math.abs(relative) / HEIGHT_SLIDER_MAX);
  return Math.sign(relative) * Math.min(1, t);
}

/** Heights the inspector shows for systems before they are an edit, by system id. */
export type HeightPreview = ReadonlyMap<number, number>;

export const NO_HEIGHT_PREVIEW: HeightPreview = new Map();
