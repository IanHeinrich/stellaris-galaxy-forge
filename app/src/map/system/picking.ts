import type { Pt } from "../../lib/geometry/pt";
import type { Camera } from "../Camera";
import { PICK_RADIUS_PX } from "../picking/zones";
import type { Exit, SceneBody } from "./context";
import { drawnDisc, exitCentre } from "./geometry";

const centre: Pt = { x: 0, y: 0 };

/**
 * The body nearest the world point `at` within its drawn disc or the pick radius, whichever is
 * larger; a star drawn from the galaxy's record while the system loads is never picked.
 */
export function pickBody(bodies: readonly SceneBody[], cam: Camera, at: Pt): number | null {
  let best: number | null = null;
  let bestPx = Infinity;
  for (const body of bodies) {
    if (body.planet === null) continue;
    const { x, y, disc } = body.placement;
    const px = Math.hypot(x - at.x, y - at.y) * cam.scale;
    const reach = Math.max(PICK_RADIUS_PX, drawnDisc(disc, cam.scale) * cam.scale);
    if (px <= reach && px < bestPx) {
      best = body.placement.id;
      bestPx = px;
    }
  }
  return best;
}

/** The neighbour whose hyperlane arrow is nearest the world point `at`, within the pick radius. */
export function pickExit(exits: readonly Exit[], cam: Camera, at: Pt): number | null {
  let best: number | null = null;
  let bestPx = PICK_RADIUS_PX;
  for (const exit of exits) {
    const c = exitCentre(exit, cam.scale, centre);
    const px = Math.hypot(c.x - at.x, c.y - at.y) * cam.scale;
    if (px <= bestPx) {
      best = exit.neighbour;
      bestPx = px;
    }
  }
  return best;
}

/** A shown name plate: its top-left in world units and its size in screen pixels. */
export interface PlatePick {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The body whose name plate, resource row included, covers the screen point `s`. */
export function pickPlate(plates: readonly PlatePick[], cam: Camera, s: Pt): number | null {
  const top: Pt = { x: 0, y: 0 };
  for (const plate of plates) {
    cam.worldToScreen(plate.x, plate.y, top);
    const inX = s.x >= top.x && s.x < top.x + plate.w;
    if (inX && s.y >= top.y && s.y < top.y + plate.h) return plate.id;
  }
  return null;
}
