import type { SystemNode } from "../generated/SystemNode";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../lib/geometry/geometry";
import type { Pt } from "../lib/geometry/pt";
import { rotateAbout } from "../lib/geometry/rotate";
import { rotationPivot, type RotationState } from "../lib/rotation";
import { RING_RADIUS } from "../lib/visual/style";
import { markerScale } from "./layers/MapLayer";
import type { Systems } from "./RenderContext";

/** How far above the selection's top ring the stalk starts, in screen pixels. */
const STALK_GAP_PX = 6;
/** How long the stalk up to the rotate handle is, in screen pixels. */
export const STALK_PX = 28;
/** A turn with Shift held lands on a multiple of this many degrees. */
export const ROTATE_SNAP_DEGREES = 15;

/** What the gizmo reads of the camera: its zoom and how much the tilt squashes world y. */
export interface GizmoView {
  scale: number;
  squash: number;
}

/**
 * A multi-selection's rotation gizmo in world-container units: the pivot it turns about, and the
 * rotate handle on its stalk, which runs up from `base`.
 */
export interface RotateGizmo {
  pivot: Pt;
  base: Pt;
  handle: Pt;
}

/**
 * The gizmo of the selection: the pivot, and a handle a fixed number of screen pixels above the
 * top of the selection where it draws, turned with it by `degrees` about the pivot. Null for
 * fewer than two systems.
 */
export function rotateGizmo(
  systems: Systems,
  state: Pick<RotationState, "selection" | "rotatePivot">,
  view: GizmoView,
  at: (s: SystemNode) => Pt,
  degrees = 0,
): RotateGizmo | null {
  if (state.selection.length < 2) return null;
  let count = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let top = Infinity;
  for (const id of state.selection) {
    const s = systems.get(id);
    if (!s) continue;
    const p = at(s);
    count++;
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    top = Math.min(top, SAVE_Y_SIGN * p.y);
  }
  const pivot = count < 2 ? null : rotationPivot(state, systems);
  if (pivot === null) return null;
  const perPx = 1 / (view.scale * view.squash);
  const gapPx = RING_RADIUS.selection * markerScale(view.scale) + STALK_GAP_PX;
  const x = (x0 + x1) / 2;
  const base = { x, y: SAVE_Y_SIGN * (top - gapPx * perPx) };
  const handle = { x, y: SAVE_Y_SIGN * (top - (gapPx + STALK_PX) * perPx) };
  if (degrees === 0) return { pivot, base, handle };
  return {
    pivot,
    base: rotateAbout(base, pivot, degrees),
    handle: rotateAbout(handle, pivot, degrees),
  };
}

/**
 * The turn about `pivot` that carries the world point `from` to `to`, in degrees clockwise as the
 * map shows it and between -180 and 180; with `snap`, to the nearest `ROTATE_SNAP_DEGREES`.
 */
export function dragTurn(pivot: Pt, from: Pt, to: Pt, snap: boolean): number {
  const world =
    Math.atan2(to.y - pivot.y, to.x - pivot.x) - Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const turned = (SAVE_X_SIGN * SAVE_Y_SIGN * world * 180) / Math.PI;
  const degrees = ((((turned + 180) % 360) + 360) % 360) - 180;
  return snap ? Math.round(degrees / ROTATE_SNAP_DEGREES) * ROTATE_SNAP_DEGREES : degrees;
}
