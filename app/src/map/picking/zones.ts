/** Pick radius for a system's star, in screen pixels. */
export const PICK_RADIUS_PX = 12;
/** Pick radius for a lane, in screen pixels; only tried when no system is under the pointer. */
export const LANE_PICK_RADIUS_PX = 6;
/** The port ring around a hovered star, in marker units (scaled like the other rings). */
export const PORT_INNER = 10;
export const PORT_OUTER = 16;
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

/** "star" inside the pick radius or the ring, "port" on the band; ports need a port-capable zoom. */
export type Zone = "star" | "port";

export function zoneOf(distancePx: number, markerK: number, portCapable: boolean): Zone | null {
  const starRadius = Math.max(PICK_RADIUS_PX, portCapable ? PORT_INNER * markerK : 0);
  if (distancePx <= starRadius) return "star";
  if (portCapable && distancePx <= PORT_OUTER * markerK) return "port";
  return null;
}

/** Outer pick reach for a system: the port ring when ports show, the star otherwise. */
export function systemReachPx(markerK: number, portCapable: boolean): number {
  return portCapable ? PORT_OUTER * markerK : PICK_RADIUS_PX;
}
