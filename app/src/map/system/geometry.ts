import type { Ring } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import { markerScale } from "../layers/MapLayer";
import type { Exit } from "./context";

/** The smallest a body's disc radius is drawn, in screen pixels, before the marker factor. */
const BODY_FLOOR_PX = 3;
/** The selected body's ring: how far past the drawn disc it stands, and its width, in screen pixels. */
export const SELECTED_GAP_PX = 7;
export const SELECTED_WIDTH_PX = 2;
/** Between the inner-radius circle and the base of a hyperlane arrow, in screen pixels. */
export const EXIT_GAP_PX = 6;
/** A hyperlane arrow's length from base to tip, and its base's width, in screen pixels. */
export const EXIT_LENGTH_PX = 14;
export const EXIT_WIDTH_PX = 12;
/** Past the tip, where the arrow's label starts, in screen pixels. */
export const EXIT_LABEL_GAP_PX = 4;
/** How far past the inner radius an arrow and its label reach, which the fit keeps in view. */
export const EXIT_REACH_PX = 40;

/** Screen pixels per dash step along a dashed ring, and the fewest and most dashes it takes. */
const DASH_STEP_PX = 10;
const MIN_DASHES = 24;
const MAX_DASHES = 720;

/** How many dashes a ring of `radius` is traced in at `scale`, about one per step on screen. */
export function ringDashes(radius: number, scale: number): number {
  const steps = Math.round((2 * Math.PI * radius * scale) / DASH_STEP_PX);
  return Math.min(MAX_DASHES, Math.max(MIN_DASHES, steps));
}

/** Whether two rings are drawn as one: centres and radii all within `within` world units. */
export function sameRing(a: Ring, b: Ring, within: number): boolean {
  return (
    Math.abs(a.cx - b.cx) < within &&
    Math.abs(a.cy - b.cy) < within &&
    Math.abs(a.radius - b.radius) < within
  );
}

/** A body's drawn disc radius in world units at `scale`: its own, or the screen-pixel floor. */
export function drawnDisc(disc: number, scale: number): number {
  return Math.max(disc, (BODY_FLOOR_PX * markerScale(scale)) / scale);
}

/** The point `px` screen pixels past the inner radius along `exit`, in world units. */
export function alongExit(exit: Exit, scale: number, px: number, out: Pt = { x: 0, y: 0 }): Pt {
  const r = exit.radius + px / scale;
  out.x = exit.dx * r;
  out.y = exit.dy * r;
  return out;
}

/** The middle of the arrow for `exit`, where a pick measures from. */
export function exitCentre(exit: Exit, scale: number, out: Pt = { x: 0, y: 0 }): Pt {
  return alongExit(exit, scale, EXIT_GAP_PX + EXIT_LENGTH_PX / 2, out);
}

/** The arrow's three corners in world units, tip first. */
export function exitTriangle(exit: Exit, scale: number, grow = 0): number[] {
  const base = EXIT_GAP_PX - grow;
  const tip = alongExit(exit, scale, base + EXIT_LENGTH_PX + 2 * grow);
  const mid = alongExit(exit, scale, base);
  const half = (EXIT_WIDTH_PX / 2 + grow) / scale;
  return [
    tip.x,
    tip.y,
    mid.x - exit.dy * half,
    mid.y + exit.dx * half,
    mid.x + exit.dy * half,
    mid.y - exit.dx * half,
  ];
}
