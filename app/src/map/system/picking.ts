import { modelSize } from "../../lib/details/structures";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../lib/geometry/geometry";
import type { Pt } from "../../lib/geometry/pt";
import { getModelPlacement, getTexture } from "../../lib/visual/textures";
import type { Camera } from "../Camera";
import { PICK_RADIUS_PX } from "../picking/zones";
import { sameHandle, type HandleRef } from "./bodyDrag";
import type {
  Exit,
  SceneBody,
  SceneHandle,
  SceneStructure,
  SceneWormhole,
  StructureKind,
  SystemContext,
} from "./context";
import { drawnDisc, drawnWormhole, exitCentre } from "./geometry";

const centre: Pt = { x: 0, y: 0 };

/** What a target with an id names: a body, a wormhole, a hyperlane arrow or a structure. */
export type IdKind = "body" | "wormhole" | "exit" | StructureKind;

/**
 * What the pointer can rest on in the scene: a body, a wormhole, a hyperlane arrow, a
 * megastructure, a starbase or a handle.
 */
export type SceneTarget =
  | { readonly kind: IdKind; readonly id: number }
  | { readonly kind: "handle"; readonly ref: HandleRef };

export function sameTarget(a: SceneTarget | null, b: SceneTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "handle") return b.kind === "handle" && sameHandle(a.ref, b.ref);
  return b.kind !== "handle" && a.kind === b.kind && a.id === b.id;
}

/** The body, wormhole, arrow or structure `target` names, as `kind`; null for anything else. */
export function idOf(target: SceneTarget | null, kind: IdKind): number | null {
  return target !== null && target.kind !== "handle" && target.kind === kind ? target.id : null;
}

/** The handle `target` names, or null. */
export function handleOf(target: SceneTarget | null): HandleRef | null {
  return target?.kind === "handle" ? target.ref : null;
}

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

/**
 * The wormhole nearest the world point `at` within its drawn vortex or the pick radius, whichever
 * is larger.
 */
export function pickWormhole(
  wormholes: readonly SceneWormhole[],
  cam: Camera,
  at: Pt,
): number | null {
  let best: number | null = null;
  let bestPx = Math.max(PICK_RADIUS_PX, drawnWormhole(cam.scale) * cam.scale);
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
 * Whether the world point `at` falls in the ellipse inscribed in `s`'s landed model sprite, so
 * the empty corners round a round model leave what is under them pickable.
 */
function onModel(s: SceneStructure, at: Pt): boolean {
  if (s.modelKey === null || !getTexture(s.modelKey)) return false;
  const placement = getModelPlacement(s.modelKey);
  if (placement === undefined) return false;
  const { width, height } = modelSize(placement, s.scale);
  const right = (at.x - s.x) * SAVE_X_SIGN;
  const down = (at.y - s.y) * SAVE_Y_SIGN;
  const { anchor_x: ax, anchor_y: ay } = placement;
  const across = (right - (0.5 - ax) * width) / (width / 2);
  const along = (down - (0.5 - ay) * height) / (height / 2);
  return across * across + along * along <= 1;
}

/** The megastructure or starbase whose landed model sprite covers the world point `at`; the nearest point wins. */
export function structureOnModel(
  structures: readonly SceneStructure[],
  at: Pt,
): SceneTarget | null {
  let best: SceneStructure | null = null;
  let bestDistance = Infinity;
  for (const s of structures) {
    const distance = Math.hypot(s.x - at.x, s.y - at.y);
    if (onModel(s, at) && distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }
  return best === null ? null : { kind: best.kind, id: best.id };
}

/**
 * The megastructure or starbase whose model covers the world point `at`, or whose point is within
 * the pick radius of it; the nearest point wins.
 */
export function pickStructure(
  structures: readonly SceneStructure[],
  cam: Camera,
  at: Pt,
): SceneTarget | null {
  let best: SceneStructure | null = null;
  let bestPx = Infinity;
  for (const s of structures) {
    const px = Math.hypot(s.x - at.x, s.y - at.y) * cam.scale;
    if ((px <= PICK_RADIUS_PX || onModel(s, at)) && px < bestPx) {
      best = s;
      bestPx = px;
    }
  }
  return best === null ? null : { kind: best.kind, id: best.id };
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

/**
 * What the world point `at` is over. A wormhole, one of the `shown` band's handles or a hyperlane
 * arrow comes first where a structure's model covers the point, then the plate `plateAt` finds
 * there, then the model, which is drawn over the bodies. Elsewhere: a body's disc, the plate
 * `plateAt` finds, a wormhole, a handle, an arrow, or a megastructure or starbase near its point.
 */
export function pickTarget(
  ctx: Pick<SystemContext, "bodies" | "wormholes" | "handles" | "exits" | "structures">,
  cam: Camera,
  at: Pt,
  plateAt: () => SceneTarget | null,
  shown: HandleRef | null,
): SceneTarget | null {
  const others = (): SceneTarget | null => {
    const wormhole = pickWormhole(ctx.wormholes, cam, at);
    if (wormhole !== null) return { kind: "wormhole", id: wormhole };
    const handle = pickHandle(ctx.handles, cam, at, shown);
    if (handle !== null) return { kind: "handle", ref: handle };
    const exit = pickExit(ctx.exits, cam, at);
    return exit === null ? null : { kind: "exit", id: exit };
  };
  const onModel = structureOnModel(ctx.structures, at);
  if (onModel !== null) return others() ?? plateAt() ?? onModel;
  // A disc wins over a plate drawn across it, so a body under another's plate stays pickable.
  const body = pickBody(ctx.bodies, cam, at);
  if (body !== null) return { kind: "body", id: body };
  return plateAt() ?? others() ?? pickStructure(ctx.structures, cam, at);
}

/** A shown name plate: its top-left in world units and its size in screen pixels. */
export interface PlatePick {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The structure whose shown plate or rows cover the screen point `s`. */
export function pickStructurePlate(
  plates: readonly Omit<PlatePick, "id">[] & readonly { target: SceneTarget }[],
  cam: Camera,
  s: Pt,
): SceneTarget | null {
  const top: Pt = { x: 0, y: 0 };
  for (const plate of plates) {
    cam.worldToScreen(plate.x, plate.y, top);
    const inX = s.x >= top.x && s.x < top.x + plate.w;
    if (inX && s.y >= top.y && s.y < top.y + plate.h) return plate.target;
  }
  return null;
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
