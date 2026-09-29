import type { Pt } from "../../lib/geometry/pt";
import type { Camera } from "../Camera";
import { PICK_RADIUS_PX } from "../picking/zones";
import { sameHandle, type HandleRef } from "./bodyDrag";
import type { Exit, SceneBody, SceneHandle, SceneWormhole, SystemContext } from "./context";
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
    const reach = Math.max(PICK_RADIUS_PX, drawnDisc(disc, cam.scale, body.look) * cam.scale);
    if (px <= reach && px < bestPx) {
      best = body.placement.id;
      bestPx = px;
    }
  }
  return best;
}

/** The wormhole whose marker is nearest the world point `at`, within the pick radius. */
export function pickWormhole(
  wormholes: readonly SceneWormhole[],
  cam: Camera,
  at: Pt,
): number | null {
  let best: number | null = null;
  let bestPx = PICK_RADIUS_PX;
  for (const { id, x, y } of wormholes) {
    const px = Math.hypot(x - at.x, y - at.y) * cam.scale;
    if (px <= bestPx) {
      best = id;
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

/**
 * The belt whose drawn band the world point `at` is over, or the inner radius it is near, within the
 * pick radius on screen: the one whose handles show. Only what has handles counts, and inside two
 * bands the nearer circle wins.
 */
export function handleOwnerAt(
  ctx: Pick<SystemContext, "handles" | "belts">,
  cam: Camera,
  at: Pt,
): HandleRef | null {
  const dist = Math.hypot(at.x, at.y);
  let best: HandleRef | null = null;
  let bestOff = Infinity;
  let seen: HandleRef | null = null;
  for (const { ref, radius } of ctx.handles) {
    if (sameHandle(ref, seen)) continue;
    seen = ref;
    const belt = ref.kind === "belt" ? ctx.belts[ref.index] : undefined;
    const half = belt ? (belt.outer - belt.inner) / 2 : 0;
    const off = Math.abs(dist - radius);
    if ((off - half) * cam.scale > PICK_RADIUS_PX || off >= bestOff) continue;
    best = ref;
    bestOff = off;
  }
  return best;
}

/** `shown`, where one of its handles is within the pick radius of the world point `at`; a hidden handle never. */
export function pickHandle(
  handles: readonly SceneHandle[],
  cam: Camera,
  at: Pt,
  shown: HandleRef | null,
): HandleRef | null {
  const near = handles.some(
    (h) =>
      sameHandle(h.ref, shown) && Math.hypot(h.x - at.x, h.y - at.y) * cam.scale <= PICK_RADIUS_PX,
  );
  return near ? shown : null;
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
