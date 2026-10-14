import type { Pt } from "../geometry/pt";
import type { MapExtent } from "../guides";
import { dir } from "./frame";
import type { GalaxyFrame, ShapeDragMods } from "./types";

/** The step Shift holds a shape's angles to, in degrees. */
export const ANGLE_STEP = 15;

/** The step a dragged rotation catches on while snapping is on, in degrees. */
const CATCH_STEP = 45;

/** How near a multiple of `CATCH_STEP` a dragged rotation catches on it, in degrees. */
export const CATCH_REACH = 4;

/** `degrees` on the nearest multiple of `step`. */
function nearestStep(degrees: number, step: number): number {
  return Math.round(degrees / step) * step;
}

/** `to` turned about `from` onto the nearest multiple of `step` degrees (`ANGLE_STEP` when left out), at the same distance. */
export function snapAngle(from: Pt, to: Pt, step: number = ANGLE_STEP): Pt {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const d = dir(nearestStep(degrees, step));
  return { x: from.x + length * d.x, y: from.y + length * d.y };
}

/**
 * The rotation a drag to `degrees` sets: on a 15° step under Shift, else on a multiple of 45°
 * within `CATCH_REACH` of one while snapping is on.
 */
export function draggedRotation(degrees: number, mods: ShapeDragMods): number {
  if (mods.constrain) return nearestStep(degrees, ANGLE_STEP);
  if (!mods.snap) return degrees;
  const caught = nearestStep(degrees, CATCH_STEP);
  return Math.abs(degrees - caught) <= CATCH_REACH ? caught : degrees;
}

/** The galaxy a shape's size is measured against: a circle extent itself, or the circle inside a square one. */
export function galaxyFrame(extent: MapExtent): GalaxyFrame {
  const centre = { x: 0, y: 0 };
  return extent.shape === "circle"
    ? { centre, radius: extent.radius }
    : { centre, radius: extent.half };
}
