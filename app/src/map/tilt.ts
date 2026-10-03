import { clampTilt } from "../lib/visual/tilt";

/** How far the galaxy plane leans away from the viewer, with the trigonometry the map reuses. */
export interface Tilt {
  readonly degrees: number;
  readonly cos: number;
  readonly sin: number;
}

export const FLAT_TILT: Tilt = Object.freeze({ degrees: 0, cos: 1, sin: 0 });

export function tiltOf(degrees: number): Tilt {
  const clamped = clampTilt(degrees);
  if (clamped === 0) return FLAT_TILT;
  const radians = (clamped * Math.PI) / 180;
  return Object.freeze({ degrees: clamped, cos: Math.cos(radians), sin: Math.sin(radians) });
}
