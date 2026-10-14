import type { Pt } from "../geometry/pt";
import type { MapExtent } from "../guides";
import type { GalaxyFrame } from "./types";

// stub: W1 fills this
const notYet = (): never => {
  throw new Error("not implemented");
};

/** The step Shift holds a shape's angles to, in degrees. */
export const ANGLE_STEP = 15;

/** `to` turned about `from` onto the nearest multiple of `step` degrees (`ANGLE_STEP` when left out), at the same distance. */
export const snapAngle: (from: Pt, to: Pt, step?: number) => Pt = notYet;

/** The galaxy a shape's size is measured against: a circle extent itself, or the circle inside a square one. */
export const galaxyFrame: (extent: MapExtent) => GalaxyFrame = notYet;
