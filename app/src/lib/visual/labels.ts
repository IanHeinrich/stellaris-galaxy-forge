import type { SystemNode } from "../../generated/SystemNode";

export type LabelTier = "none" | "some";

/** One notch of the mouse wheel: the zoom factor `MapController` applies per 100 px. */
const WHEEL_NOTCH = 1.1;

/**
 * Pixels per world unit up to which empire names and emblems show. The game keeps them until
 * the camera is a third closer than where star names used to appear here
 * (`BORDER_NAMES_FADEOUT_ZOOM` 600 against `GALAXY_SHOW_STARNAME_ZOOM` 800, from 3).
 */
export const EMPIRE_LABEL_MAX_SCALE = (3 * 800) / 600;

/** Pixels per world unit at which system names pop in: a wheel notch after empire names go. */
export const DETAIL_SCALE = EMPIRE_LABEL_MAX_SCALE * WHEEL_NOTCH;

/** Zoom from which a system's ring shows lane ports; grabbing them any further out is too fiddly. */
export const PORT_MIN_SCALE = 0.9;

export function portCapable(scale: number): boolean {
  return scale >= PORT_MIN_SCALE;
}

/** Whether any labels are drawn at a zoom level (pixels per world unit). */
export function labelTier(scale: number): LabelTier {
  return scale < DETAIL_SCALE ? "none" : "some";
}

/** Bypass systems first, then hubs by lane count, ties broken by id. */
export function compareImportance(a: SystemNode, b: SystemNode): number {
  const bypass = Number(b.bypass_ids.length > 0) - Number(a.bypass_ids.length > 0);
  if (bypass !== 0) return bypass;
  if (a.lanes.length !== b.lanes.length) return b.lanes.length - a.lanes.length;
  return a.id - b.id;
}
