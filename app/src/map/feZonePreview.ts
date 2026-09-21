import type { FeDirection } from "../generated/FeDirection";
import type { SystemNode } from "../generated/SystemNode";
import {
  FE_DIRECTIONS,
  FE_ZONE_DISTANCES,
  feZoneBlocked,
  feZoneCentre,
  feZoneOffMap,
  snapFeZone,
} from "../lib/feZone";
import type { Systems } from "./RenderContext";

/** One position on the mod's 8 × 18 grid around an anchor: where it sits, and whether it is free. */
export interface FeZoneSlot {
  direction: FeDirection;
  distance: number;
  x: number;
  y: number;
  /** Whether the ring here is clear of every system and stays on the mod's canvas. */
  clear: boolean;
}

/** The ring a drag is proposing for one zone: where it snapped to, what stands in its way, and the grid it chose from. */
export interface FeZonePreview {
  anchor: { x: number; y: number };
  direction: FeDirection;
  distance: number;
  /** The ring's centre. */
  x: number;
  y: number;
  /** The system the ring would cover, or null when it is clear. */
  blocked: SystemNode | null;
  /** Whether the ring would leave the mod's canvas. */
  offMap: boolean;
  /** Every position the mod accepts around the anchor: all 8 directions × 18 distances. */
  slots: FeZoneSlot[];
}

interface SlotsCache {
  systems: Systems;
  anchorId: number;
  anchorX: number;
  anchorY: number;
  slots: FeZoneSlot[];
}

let slotsCache: SlotsCache | null = null;

/**
 * All 144 positions on the mod's grid around `anchor`. A drag calls this on every pointer move,
 * but the grid depends only on the anchor and the systems, both fixed for the drag's length, so
 * the last result is kept and reused while they stay the same object and position.
 */
function feZoneSlots(
  systems: Systems,
  anchorId: number,
  anchor: { x: number; y: number },
): FeZoneSlot[] {
  const cached = slotsCache;
  if (
    cached &&
    cached.systems === systems &&
    cached.anchorId === anchorId &&
    cached.anchorX === anchor.x &&
    cached.anchorY === anchor.y
  ) {
    return cached.slots;
  }
  const slots: FeZoneSlot[] = [];
  for (const { key: direction } of FE_DIRECTIONS) {
    for (const distance of FE_ZONE_DISTANCES) {
      const centre = feZoneCentre(anchor, { direction, distance });
      const clear = feZoneBlocked(centre, systems, anchorId) === null && !feZoneOffMap(centre);
      slots.push({ direction, distance, x: centre.x, y: centre.y, clear });
    }
  }
  slotsCache = { systems, anchorId, anchorX: anchor.x, anchorY: anchor.y, slots };
  return slots;
}

/**
 * The ring nearest the pointer on the mod's grid around `anchorId`, as the core would judge
 * it; null when the anchor is gone.
 */
export function feZonePreview(
  systems: Systems,
  anchorId: number,
  pointer: { x: number; y: number },
): FeZonePreview | null {
  const anchor = systems.get(anchorId);
  if (!anchor) return null;
  const snapped = snapFeZone(anchor, pointer);
  const centre = feZoneCentre(anchor, snapped);
  return {
    anchor: { x: anchor.x, y: anchor.y },
    ...snapped,
    ...centre,
    blocked: feZoneBlocked(centre, systems, anchorId),
    offMap: feZoneOffMap(centre),
    slots: feZoneSlots(systems, anchorId, anchor),
  };
}
