/** Pick radius for a system's star, in screen pixels. */
const PICK_RADIUS_PX = 12;
/** Pick radius for a lane, in screen pixels; only tried when no system is under the pointer. */
export const LANE_PICK_RADIUS_PX = 6;
/** The port ring around a hovered star, in marker units (scaled like the other rings). */
export const PORT_INNER = 10;
export const PORT_OUTER = 16;
/** How wide a port band is, in marker units: a star's, and a zone's just outside its ring band. */
const PORT_WIDTH = PORT_OUTER - PORT_INNER;
/** A lane drag snaps to the nearest system inside this many screen pixels. */
export const SNAP_RADIUS_PX = 24;
/** Radius of a hovered lane's midpoint "×" button, in screen pixels. */
export const MIDPOINT_HIT_PX = 8;
/** Pick radius for a nebula's centre marker and its name, in screen pixels. */
export const NEBULA_CENTRE_HIT_PX = 22;
/** Pick radius for one of a selected nebula's four cardinal handles, in screen pixels. */
export const NEBULA_HANDLE_HIT_PX = 8;
/** Half-width of a nebula's ring band, in screen pixels; inside the disc is not a hit. */
export const NEBULA_RING_HIT_PX = 6;
/** Half-width of a fallen empire zone's ring band, in screen pixels; the disc itself is not a hit. */
export const FE_ZONE_RING_HIT_PX = 6;

/**
 * Where on the body under the pointer it is: a star inside its pick radius, a zone's ring on
 * its band, or the port band outside either; a star's port needs a port-capable zoom.
 */
export type Zone = "star" | "ring" | "port";

export function zoneOf(distancePx: number, markerK: number, portCapable: boolean): Zone | null {
  const starRadius = Math.max(PICK_RADIUS_PX, portCapable ? PORT_INNER * markerK : 0);
  if (distancePx <= starRadius) return "star";
  if (portCapable && distancePx <= PORT_OUTER * markerK) return "port";
  return null;
}

/** The ring band either side of a zone's ring line, or the port band outside it; `offsetPx` is positive outside. */
export function ringZoneOf(offsetPx: number, markerK: number): "ring" | "port" | null {
  if (Math.abs(offsetPx) <= FE_ZONE_RING_HIT_PX) return "ring";
  if (offsetPx > 0 && offsetPx <= FE_ZONE_RING_HIT_PX + PORT_WIDTH * markerK) return "port";
  return null;
}

/** How far beyond a zone's ring line the middle of its port band lies, in screen pixels. */
export function ringPortOffsetPx(markerK: number): number {
  return FE_ZONE_RING_HIT_PX + (PORT_WIDTH * markerK) / 2;
}

/** Outer pick reach for a system: the port ring when ports show, the star otherwise. */
export function systemReachPx(markerK: number, portCapable: boolean): number {
  return portCapable ? PORT_OUTER * markerK : PICK_RADIUS_PX;
}
