import type { ShapePreview } from "../lib/shapes/types";

/**
 * What placing the pending shape would add to the galaxy as it stands; null with no pending
 * shape. Cached on the identity of its inputs, so the map and the panels share one result.
 */
export function shapePreview(): ShapePreview | null {
  // stub: W2 fills this
  return null;
}

/** `shapePreview()`, read by a component that redraws when it changes. */
export function useShapePreview(): ShapePreview | null {
  // stub: W2 fills this
  return null;
}
