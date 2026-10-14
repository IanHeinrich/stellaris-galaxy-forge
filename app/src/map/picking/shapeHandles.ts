import type { Pt } from "../../lib/geometry/pt";
import type { PendingShape, ShapePick } from "../../lib/shapes/types";
import type { Camera } from "../Camera";

// stub: W3 fills this
const notYet = (): never => {
  throw new Error("not implemented");
};

/**
 * What of the pending shape a world point grabs: the nearest handle within a fixed number of
 * screen pixels at any zoom, else the inside; null off the shape or with none pending.
 */
export const pickShape: (pending: PendingShape | null, cam: Camera, at: Pt) => ShapePick | null =
  notYet;
