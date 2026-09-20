import type { Nebula } from "../../generated/Nebula";
import type { SystemNode } from "../../generated/SystemNode";
import type { LaneRef } from "../../store/editorStore";
import { unlinkedTo } from "../../store/galaxyStore";
import type { Camera, Pt } from "../Camera";
import type { LaneTarget } from "../interaction/MapIntent";
import { nearestLane } from "./nearestLane";
import {
  LANE_PICK_RADIUS_PX,
  MIDPOINT_HIT_PX,
  NEBULA_CENTRE_HIT_PX,
  NEBULA_HANDLE_HIT_PX,
  NEBULA_RING_HIT_PX,
  SNAP_RADIUS_PX,
  systemReachPx,
  zoneOf,
  type Zone,
} from "./zones";
import { portCapable as portsAt } from "../../lib/visual/labels";
import { markerScale } from "../layers/MapLayer";
import type { Systems } from "../RenderContext";
import type { SpatialGrid } from "../../lib/spatialGrid";

/** So a near-zero nebula stays grabbable. */
const NEBULA_CENTRE_MIN_HIT_PX = 4;

export interface SystemPick {
  system: number | null;
  /** Where on the system the point landed, or `null` when it landed on none. */
  zone: Zone | null;
}

export interface LanePick {
  lane: LaneRef | null;
  /** Whether the point is on the hovered lane's midpoint button. */
  midpointHit: boolean;
}

/** Where on a nebula a point landed: its centre marker, a resize handle, or its ring band. */
export type NebulaPart = "centre" | "handle" | "ring";

export interface NebulaPick {
  index: number;
  part: NebulaPart;
  /** Which axis a handle lies on: `x` for the east and west handles, `y` for north and south. */
  axis?: "x" | "y";
}

/** The four cardinal points of a nebula's ring, where its resize handles sit: +x, -x, +y, -y. */
export function nebulaHandles(n: Nebula): Pt[] {
  return [
    { x: n.x + n.radius, y: n.y },
    { x: n.x - n.radius, y: n.y },
    { x: n.x, y: n.y + n.radius },
    { x: n.x, y: n.y - n.radius },
  ];
}

const PART_RANK: Record<NebulaPart, number> = { centre: 0, handle: 1, ring: 2 };

/**
 * The nebula a world point grabs, and where. Inside the disc is not a hit, so a click there
 * still clears the selection or starts a marquee; handles only answer while `selected` is theirs.
 * A cloud drawn smaller than the centre marker keeps half its radius for the ring.
 */
export function pickNebula(
  nebulae: readonly Nebula[],
  cam: Camera,
  at: Pt,
  selected: number | null,
): NebulaPick | null {
  let best: NebulaPick | null = null;
  let bestRank = Infinity;
  let bestDist = Infinity;
  nebulae.forEach((n, index) => {
    const hit = hitOn(n, cam, at, index === selected);
    if (!hit) return;
    const rank = PART_RANK[hit.part];
    if (rank > bestRank || (rank === bestRank && hit.dist >= bestDist)) return;
    best = hit.axis ? { index, part: hit.part, axis: hit.axis } : { index, part: hit.part };
    bestRank = rank;
    bestDist = hit.dist;
  });
  return best;
}

/** The closest part of one nebula the point is on, with its distance in screen pixels. */
function hitOn(
  n: Nebula,
  cam: Camera,
  at: Pt,
  selected: boolean,
): { part: NebulaPart; dist: number; axis?: "x" | "y" } | null {
  const toCentre = Math.hypot(n.x - at.x, n.y - at.y);
  const centrePx = toCentre * cam.scale;
  const centreHit = Math.max(
    NEBULA_CENTRE_MIN_HIT_PX,
    Math.min(NEBULA_CENTRE_HIT_PX, (n.radius * cam.scale) / 2),
  );
  if (centrePx <= centreHit) {
    return { part: "centre", dist: centrePx };
  }
  if (selected) {
    let handlePx = Infinity;
    let axis: "x" | "y" = "x";
    nebulaHandles(n).forEach((h, i) => {
      const px = Math.hypot(h.x - at.x, h.y - at.y) * cam.scale;
      if (px < handlePx) {
        handlePx = px;
        axis = i < 2 ? "x" : "y";
      }
    });
    if (handlePx <= NEBULA_HANDLE_HIT_PX) return { part: "handle", dist: handlePx, axis };
  }
  const ringPx = Math.abs(toCentre - n.radius) * cam.scale;
  return ringPx <= NEBULA_RING_HIT_PX ? { part: "ring", dist: ringPx } : null;
}

/** The system under a world point, and whether the point is on its star or its port band. */
export function pickSystem(grid: SpatialGrid, cam: Camera, at: Pt): SystemPick {
  const k = markerScale(cam.scale);
  const portCapable = portsAt(cam.scale);
  const reach = systemReachPx(k, portCapable) / cam.scale;
  const s = grid.nearestSystem(at.x, at.y, reach);
  if (!s) return { system: null, zone: null };
  const zone = zoneOf(Math.hypot(s.x - at.x, s.y - at.y) * cam.scale, k, portCapable);
  return zone ? { system: s.id, zone } : { system: null, zone: null };
}

/** The lane under a world point; `sticky` keeps the hovered lane while the point is on its button. */
export function pickLane(systems: Systems, cam: Camera, at: Pt, sticky: LaneRef | null): LanePick {
  if (sticky && nearMidpoint(systems, cam, sticky, at)) return { lane: sticky, midpointHit: true };
  const lane = nearestLane(systems, at.x, at.y, LANE_PICK_RADIUS_PX / cam.scale);
  return { lane, midpointHit: lane !== null && nearMidpoint(systems, cam, lane, at) };
}

/** Whether a world point is within the midpoint button of `lane`. */
export function nearMidpoint(systems: Systems, cam: Camera, lane: LaneRef, at: Pt): boolean {
  const a = systems.get(lane.a);
  const b = systems.get(lane.b);
  if (!a || !b) return false;
  const d = Math.hypot((a.x + b.x) / 2 - at.x, (a.y + b.y) / 2 - at.y);
  return d * cam.scale <= MIDPOINT_HIT_PX;
}

/** The system a lane drag from `from` would snap to, and whether that lane could be added. */
export function snapTarget(
  grid: SpatialGrid,
  systems: Systems,
  cam: Camera,
  at: Pt,
  from: number[],
): LaneTarget | null {
  const s = nearestOutside(grid, at, SNAP_RADIUS_PX / cam.scale, from);
  if (!s) return null;
  return { id: s.id, valid: unlinkedTo(systems, s.id, from).length > 0 };
}

/** The closest system to a world point within `maxDist`, skipping `excluded`. */
export function nearestOutside(
  grid: SpatialGrid,
  at: Pt,
  maxDist: number,
  excluded: number[],
): SystemNode | null {
  let best: SystemNode | null = null;
  let bestD2 = maxDist * maxDist;
  grid.forEachIn(at.x - maxDist, at.y - maxDist, at.x + maxDist, at.y + maxDist, (s) => {
    if (excluded.includes(s.id)) return;
    const d2 = (s.x - at.x) ** 2 + (s.y - at.y) ** 2;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = s;
    }
  });
  return best;
}
