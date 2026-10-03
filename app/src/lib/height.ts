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
