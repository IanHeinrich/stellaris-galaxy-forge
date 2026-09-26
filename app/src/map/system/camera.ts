import { MIN_DISC_RADIUS } from "../../lib/details/discs";

/** Pixels per world unit at which `fitRadius` reaches the edge of the view's short side. */
export function fitScale(fitRadius: number, width: number, height: number): number {
  return Math.min(width, height) / (2 * Math.max(fitRadius, 1));
}

/** Out to half the fit scale; in until the largest disc's diameter fills the short side. */
export function zoomLimits(
  fitRadius: number,
  width: number,
  height: number,
  largestDisc: number,
): { minScale: number; maxScale: number } {
  return {
    minScale: fitScale(fitRadius, width, height) / 2,
    maxScale: Math.min(width, height) / (2 * Math.max(largestDisc, MIN_DISC_RADIUS)),
  };
}
