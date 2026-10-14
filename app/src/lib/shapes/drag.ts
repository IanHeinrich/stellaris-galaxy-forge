import type { Pt } from "../geometry/pt";
import type { MapExtent } from "../guides";
import { dir } from "./frame";
import type { GalaxyFrame } from "./types";

/** The step Shift holds a shape's angles to, in degrees. */
export const ANGLE_STEP = 15;

/** `to` turned about `from` onto the nearest multiple of `step` degrees (`ANGLE_STEP` when left out), at the same distance. */
export function snapAngle(from: Pt, to: Pt, step: number = ANGLE_STEP): Pt {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const d = dir(Math.round(degrees / step) * step);
  return { x: from.x + length * d.x, y: from.y + length * d.y };
}

/** The galaxy a shape's size is measured against: a circle extent itself, or the circle inside a square one. */
export function galaxyFrame(extent: MapExtent): GalaxyFrame {
  const centre = { x: 0, y: 0 };
  return extent.shape === "circle"
    ? { centre, radius: extent.radius }
    : { centre, radius: extent.half };
}
