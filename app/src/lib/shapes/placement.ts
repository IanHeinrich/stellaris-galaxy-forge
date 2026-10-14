import type { PendingShape, ShapeGround, ShapePreview } from "./types";

// stub: W1 fills this
const notYet = (): never => {
  throw new Error("not implemented");
};

/**
 * The systems and lanes `pending` would add to `ground`, and the points it leaves out. Pure, so
 * the same pending shape and ground give the same placement in the preview and in the edit.
 */
export const shapePlacement: (pending: PendingShape, ground: ShapeGround) => ShapePreview = notYet;
