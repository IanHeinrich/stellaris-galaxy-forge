import type { LaneSource, MapInput } from "./MapIntent";

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/** What was under the pointer and which modifiers were held when the button went down. */
export type Press = Omit<MapInput, "kind" | "button" | "alt" | "snap">;

export function pressFrom(input: MapInput): Press {
  return { ...input };
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
