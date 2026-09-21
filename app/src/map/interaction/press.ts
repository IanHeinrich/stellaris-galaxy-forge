import type { FeZonePick, NebulaPick } from "../picking";
import type { MapEdge } from "../picking/edges";
import { DRAG_THRESHOLD_PX, type LaneSource, type MapInput } from "./MapIntent";
import type { Zone } from "../picking/zones";

/** What was under the pointer and which modifiers were held when the button went down. */
export interface Press {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  system: number | null;
  zone: Zone | null;
  edge: MapEdge | null;
  midpointHit: boolean;
  feZone: FeZonePick | null;
  nebula: NebulaPick | null;
  shift: boolean;
  ctrl: boolean;
  selection: number[];
}

export function pressFrom(input: MapInput): Press {
  return {
    sx: input.sx,
    sy: input.sy,
    wx: input.wx,
    wy: input.wy,
    system: input.system,
    zone: input.zone,
    edge: input.edge,
    midpointHit: input.midpointHit,
    feZone: input.feZone,
    nebula: input.nebula,
    shift: input.shift,
    ctrl: input.ctrl,
    selection: input.selection,
  };
}

export function pastThreshold(press: Press, input: MapInput): boolean {
  return Math.hypot(input.sx - press.sx, input.sy - press.sy) >= DRAG_THRESHOLD_PX;
}

/** The selected systems a drag from `id` acts on together, or null when it acts on `id` alone. */
export function groupOf(selection: number[], id: number): number[] | null {
  return selection.length > 1 && selection.includes(id) ? selection : null;
}

/** What a lane drag from the press starts from: a port, or Shift on a star or a ring; null otherwise. */
export function laneSourceOf(press: Press): LaneSource | null {
  if (press.system !== null) {
    if (press.zone !== "port" && !press.shift) return null;
    return { kind: "systems", ids: groupOf(press.selection, press.system) ?? [press.system] };
  }
  if (press.feZone && (press.zone === "port" || press.shift)) {
    return { kind: "feZone", anchor: press.feZone.anchor };
  }
  return null;
}
