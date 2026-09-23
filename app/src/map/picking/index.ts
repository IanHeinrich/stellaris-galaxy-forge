import type { Nebula } from "../../generated/Nebula";
import type { SystemNode } from "../../generated/SystemNode";
import type { LaneRef } from "../../store/editorStore";
import { unlinkedTo } from "../../store/galaxyStore";
import { distToSegmentSq } from "../../lib/geometry/geometry";
import { pairOf } from "../../lib/geometry/pairs";
import { dist2, type Pt } from "../../lib/geometry/pt";
import type { Camera } from "../Camera";
import type { LaneSource, LaneTarget } from "../interaction/MapIntent";
import { linkRefusal, type Segment } from "../../lib/feLinks";
import { FE_ZONE_RADIUS, feZoneCentre } from "../../lib/feZone";
import { edgeEnds, type MapEdge } from "./edges";
import type { PickIndex } from "./pickIndex";
import {
  LANE_PICK_RADIUS_PX,
  MIDPOINT_HIT_PX,
  NEBULA_CENTRE_HIT_PX,
  NEBULA_HANDLE_HIT_PX,
  NEBULA_RING_HIT_PX,
  ringZoneOf,
  SNAP_RADIUS_PX,
  systemReachPx,
  zoneOf,
  type Zone,
} from "./zones";
import { portCapable as portsAt } from "../../lib/visual/labels";
import { markerScale } from "../layers/MapLayer";
import type { Systems } from "../RenderContext";
import type { SpatialGrid } from "../../lib/spatialGrid";

/** So a near-zero nebula or zone stays grabbable. */
const CENTRE_MIN_HIT_PX = 4;

/** How far from its centre a disc of world `radius` is grabbed by the centre, in screen pixels. */
function centreReachPx(radius: number, scale: number): number {
  return Math.max(CENTRE_MIN_HIT_PX, Math.min(NEBULA_CENTRE_HIT_PX, (radius * scale) / 2));
}

export interface SystemPick {
  system: number | null;
  /** Where on the system the point landed, or `null` when it landed on none. */
  zone: Zone | null;
}

export interface EdgePick {
  edge: MapEdge | null;
  /** Whether the point is on the hovered edge's midpoint button. */
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
  if (centrePx <= centreReachPx(n.radius, cam.scale)) {
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

/** A fallen empire zone under the pointer, named by the system that anchors it, and where on it. */
export interface FeZonePick {
  anchor: number;
  /** On the ring band, or on the port band just outside it. */
  zone: "ring" | "port";
}

/** Which part of a zone wins where a point is on more than one zone: the ring band first. */
const ZONE_RANK = { ring: 0, port: 1, centre: 2 } as const;

/**
 * The zone whose ring band, port band or centre a world point is on, a ring band winning over a
 * port band, either over a centre, and the nearer ring where two overlap. A centre reads as the
 * ring, so pressing there moves the zone; the rest of the inside is empty space, where a click
 * clears the selection or starts a marquee as it would anywhere else.
 */
export function pickFeZone(index: PickIndex, cam: Camera, at: Pt): FeZonePick | null {
  const k = markerScale(cam.scale);
  let best: FeZonePick | null = null;
  let bestRank = Infinity;
  let bestPx = Infinity;
  for (const s of index.anchors()) {
    const offset = ringOffset(s, at);
    if (offset === null) continue;
    const px = Math.abs(offset) * cam.scale;
    const ring = ringZoneOf(offset * cam.scale, k);
    const rank = ring ? ZONE_RANK[ring] : centreHit(offset, cam) ? ZONE_RANK.centre : null;
    if (rank === null) continue;
    if (rank > bestRank || (rank === bestRank && px >= bestPx)) continue;
    best = { anchor: s.id, zone: ring ?? "ring" };
    bestRank = rank;
    bestPx = px;
  }
  return best;
}

/** Whether a point `offset` outside the ring (negative inside) is within the zone's centre handle. */
function centreHit(offset: number, cam: Camera): boolean {
  return (offset + FE_ZONE_RADIUS) * cam.scale <= centreReachPx(FE_ZONE_RADIUS, cam.scale);
}

/** How far a world point lies outside the ring `anchor` anchors, negative inside; null without a zone. */
function ringOffset(anchor: SystemNode, at: Pt): number | null {
  if (anchor.fe_zone === null) return null;
  const c = feZoneCentre(anchor, anchor.fe_zone);
  return Math.hypot(c.x - at.x, c.y - at.y) - FE_ZONE_RADIUS;
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

/**
 * The edge under a world point, a lane before a zone's link and links only while `links`;
 * `sticky` keeps the hovered edge while the point is on its button.
 */
export function pickEdge(
  index: PickIndex,
  systems: Systems,
  cam: Camera,
  at: Pt,
  sticky: MapEdge | null,
  links: boolean,
): EdgePick {
  if (sticky && nearMidpoint(cam, edgeEnds(systems, sticky), at)) {
    return { edge: sticky, midpointHit: true };
  }
  const edge = index.nearestEdge(at.x, at.y, LANE_PICK_RADIUS_PX / cam.scale, links);
  return { edge, midpointHit: edge !== null && nearMidpoint(cam, edgeEnds(systems, edge), at) };
}

/**
 * The pair the scenario keeps from a lane whose dash lies under a world point, the nearest where
 * two do. Only a right-click asks, so it scans every pair rather than keep an index of them.
 */
export function pickPrevented(systems: Systems, cam: Camera, at: Pt): LaneRef | null {
  let best: LaneRef | null = null;
  let bestD2 = (LANE_PICK_RADIUS_PX / cam.scale) ** 2;
  for (const s of systems.values()) {
    for (const to of s.prevented) {
      const b = systems.get(to);
      if (!b) continue;
      const d2 = distToSegmentSq(at.x, at.y, s.x, s.y, b.x, b.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        const [lo, hi] = pairOf(s.id, to);
        best = { a: lo, b: hi };
      }
    }
  }
  return best;
}

/** Whether a world point is within the midpoint button of a segment. */
function nearMidpoint(cam: Camera, segment: Segment | null, at: Pt): boolean {
  if (!segment) return false;
  const { a, b } = segment;
  const d = Math.hypot((a.x + b.x) / 2 - at.x, (a.y + b.y) / 2 - at.y);
  return d * cam.scale <= MIDPOINT_HIT_PX;
}

const NO_NAME = () => "";
const NO_IDS: ReadonlySet<number> = new Set();
const idSets = new WeakMap<readonly number[], ReadonlySet<number>>();

/** `ids` as a set, made once per array: a lane drag hands the same group to every move. */
function idSet(ids: readonly number[]): ReadonlySet<number> {
  let set = idSets.get(ids);
  if (!set) {
    set = new Set(ids);
    idSets.set(ids, set);
  }
  return set;
}

/**
 * What a lane drag from `from` would snap to: the nearest system inside the snap radius or,
 * for a drag from systems while `zones` show, the zone whose ring line is; and whether the
 * lane or link could be added.
 */
export function snapTarget(
  grid: SpatialGrid,
  index: PickIndex,
  systems: Systems,
  cam: Camera,
  at: Pt,
  from: LaneSource,
  zones: boolean,
): LaneTarget | null {
  const reach = SNAP_RADIUS_PX / cam.scale;
  const s = nearestOutside(grid, at, reach, from.kind === "systems" ? idSet(from.ids) : NO_IDS);
  if (s) return { kind: "system", id: s.id, valid: canConnect(systems, from, s) };
  if (from.kind !== "systems" || !zones) return null;
  const anchor = nearestRing(index, at, reach);
  if (!anchor) return null;
  const valid = from.ids.some((id) => {
    const system = systems.get(id);
    return system !== undefined && linkRefusal(anchor, system, NO_NAME) === null;
  });
  return { kind: "feZone", anchor: anchor.id, valid };
}

/** Whether a drag from `from` dropped on `target` adds a lane, or a link from a zone's port. */
function canConnect(systems: Systems, from: LaneSource, target: SystemNode): boolean {
  if (from.kind === "systems") return unlinkedTo(systems, target.id, from.ids).length > 0;
  const anchor = systems.get(from.anchor);
  return anchor !== undefined && linkRefusal(anchor, target, NO_NAME) === null;
}

/** The anchor whose ring line lies within `maxDist` of a world point, the nearest where two do. */
function nearestRing(index: PickIndex, at: Pt, maxDist: number): SystemNode | null {
  let best: SystemNode | null = null;
  let bestOffset = maxDist;
  for (const s of index.anchors()) {
    const offset = ringOffset(s, at);
    if (offset !== null && Math.abs(offset) <= bestOffset) {
      bestOffset = Math.abs(offset);
      best = s;
    }
  }
  return best;
}

/** The closest system to a world point within `maxDist`, skipping `excluded`. */
function nearestOutside(
  grid: SpatialGrid,
  at: Pt,
  maxDist: number,
  excluded: ReadonlySet<number>,
): SystemNode | null {
  let best: SystemNode | null = null;
  let bestD2 = Infinity;
  grid.forEachWithin(at.x, at.y, maxDist, (s) => {
    if (excluded.has(s.id)) return;
    const d2 = dist2(s, at);
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = s;
    }
  });
  return best;
}
