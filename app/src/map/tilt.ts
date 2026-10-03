import type { SystemNode } from "../generated/SystemNode";
import { SAVE_Y_SIGN } from "../lib/geometry/geometry";
import type { Pt } from "../lib/geometry/pt";
import { NO_HEIGHT_PREVIEW, relativeHeight, type HeightPreview } from "../lib/height";
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

/** The game's own scale: it lifts a star by half its visual_height. */
export const LIFT_SCALE = 0.5;

/**
 * The y in the world container at which a point `relative` above the plane draws under `tilt`.
 * The container squashes y by the tilt's cosine, so the lift is stretched by the same factor to
 * rise `relative · sin` on screen.
 */
export function liftedY(y: number, relative: number, tilt: Tilt): number {
  if (tilt.sin === 0 || relative === 0) return y;
  return y - (SAVE_Y_SIGN * relative * LIFT_SCALE * tilt.sin) / tilt.cos;
}

/**
 * A system's height above the game's default plane, or the one `preview` shows for it; a save
 * without heights reads as flat.
 */
export function systemHeight(s: SystemNode, preview: HeightPreview = NO_HEIGHT_PREVIEW): number {
  return preview.get(s.id) ?? relativeHeight(s.height);
}

/** The y at which system `s` draws in the world container under `tilt`. */
export function systemY(
  s: SystemNode,
  tilt: Tilt,
  preview: HeightPreview = NO_HEIGHT_PREVIEW,
): number {
  return tilt.sin === 0 ? s.y : liftedY(s.y, systemHeight(s, preview), tilt);
}

/** Where system `s` draws in the world container under `tilt`: itself while the map is flat. */
export function liftedPoint(
  s: SystemNode,
  tilt: Tilt,
  preview: HeightPreview = NO_HEIGHT_PREVIEW,
): Pt {
  return tilt.sin === 0 ? s : { x: s.x, y: systemY(s, tilt, preview) };
}

/** Whether any of `ids` is among the systems whose previewed height `changed`. */
export function movedAny(changed: ReadonlySet<number>, ids: Iterable<number>): boolean {
  for (const id of ids) if (changed.has(id)) return true;
  return false;
}

/** The systems whose shown height differs between two previews, ended previews included. */
export function previewChanges(from: HeightPreview, to: HeightPreview): Set<number> {
  const changed = new Set<number>();
  for (const [id, height] of to) if (from.get(id) !== height) changed.add(id);
  for (const id of from.keys()) if (!to.has(id)) changed.add(id);
  return changed;
}

/** The largest height off the plane among `systems`, previews included, for culling by where stars draw. */
export function highestHeight(
  systems: Iterable<SystemNode>,
  preview: HeightPreview = NO_HEIGHT_PREVIEW,
): number {
  let highest = 0;
  for (const s of systems) highest = Math.max(highest, Math.abs(relativeHeight(s.height)));
  for (const height of preview.values()) highest = Math.max(highest, Math.abs(height));
  return highest;
}

/** How far in world y a system `highest` off the plane may draw from its own y under `tilt`. */
export function liftReach(highest: number, tilt: Tilt): number {
  return Math.abs(liftedY(0, highest, tilt));
}
