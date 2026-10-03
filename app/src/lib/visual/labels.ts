import type { SystemNode } from "../../generated/SystemNode";

export type LabelTier = "none" | "some";

/**
 * Pixels per world unit past which empire names and emblems fade out. The game's threshold is a
 * third closer than its star names' (`BORDER_NAMES_FADEOUT_ZOOM` 600 against
 * `GALAXY_SHOW_STARNAME_ZOOM` 800, from 3).
 */
export const EMPIRE_LABEL_MAX_SCALE = (3 * 800) / 600;

/** Pixels per world unit at which system names and details pop in, as empire names begin to fade. */
export const DETAIL_SCALE = EMPIRE_LABEL_MAX_SCALE;

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
