import type { SystemNode } from "../generated/SystemNode";
import { SAVE_Y_SIGN } from "../lib/geometry/geometry";
import type { Pt } from "../lib/geometry/pt";
import { relativeHeight } from "../lib/height";
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

export function isTilted(tilt: Tilt): boolean {
  return tilt.degrees > 0;
}

/** World units a system rises on screen per unit of height at a right angle: exaggerated, so ±100 reads at the galaxy's fit zoom. */
export const LIFT_SCALE = 1.5;

/**
 * The y in the world container at which a point `relative` above the plane draws under `tilt`.
 * The container squashes y by the tilt's cosine, so the lift is stretched by the same factor to
 * rise `relative · sin` on screen.
 */
export function liftedY(y: number, relative: number, tilt: Tilt): number {
  if (tilt.sin === 0 || relative === 0) return y;
  return y - (SAVE_Y_SIGN * relative * LIFT_SCALE * tilt.sin) / tilt.cos;
}

/** A system's height above the game's default plane; a save without heights reads as flat. */
export function systemHeight(s: SystemNode): number {
  return relativeHeight(s.height);
}

/** The y at which system `s` draws in the world container under `tilt`. */
export function systemY(s: SystemNode, tilt: Tilt): number {
  return tilt.sin === 0 ? s.y : liftedY(s.y, systemHeight(s), tilt);
}

/** Where system `s` draws in the world container under `tilt`: itself while the map is flat. */
export function liftedPoint(s: SystemNode, tilt: Tilt): Pt {
  return tilt.sin === 0 ? s : { x: s.x, y: systemY(s, tilt) };
}
