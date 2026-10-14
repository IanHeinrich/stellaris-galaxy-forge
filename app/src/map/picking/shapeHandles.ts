import type { Pt } from "../../lib/geometry/pt";
import { specOf } from "../../lib/shapes/specs";
import type { PendingShape, ShapePick } from "../../lib/shapes/types";
import type { Camera } from "../Camera";

/** Pick radius for one of the pending shape's handles, in screen pixels. */
export const SHAPE_HANDLE_HIT_PX = 9;

/**
 * What of the pending shape a world point grabs: the nearest handle within a fixed number of
 * screen pixels at any zoom, else the inside; null off the shape or with none pending.
 */
export function pickShape(pending: PendingShape | null, cam: Camera, at: Pt): ShapePick | null {
  if (!pending) return null;
  const spec = specOf(pending.shape);
  let best: ShapePick | null = null;
  let bestPx = SHAPE_HANDLE_HIT_PX;
  for (const h of spec.handles(pending.shape)) {
    const px = Math.hypot(h.at.x - at.x, h.at.y - at.y) * cam.scale;
    if (px <= bestPx) {
      bestPx = px;
      best = { kind: "handle", id: h.id };
    }
  }
  if (best) return best;
  return spec.contains(pending.shape, at) ? { kind: "inside" } : null;
}
