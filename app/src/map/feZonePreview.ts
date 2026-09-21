import type { FeDirection } from "../generated/FeDirection";
import type { SystemNode } from "../generated/SystemNode";
import { feZoneBlocked, feZoneCentre, feZoneOffMap, snapFeZone } from "../lib/feZone";
import type { Systems } from "./RenderContext";

/** The ring a drag is proposing for one zone: where it snapped to, and what stands in its way. */
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
  };
}
