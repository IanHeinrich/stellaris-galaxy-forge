/**
 * Paint a Galaxy's fallen empire zones: the ring of empty space an anchor system points at,
 * where the mod creates a fallen empire's systems when the game starts. The maths mirrors
 * `crates/sgf-core/src/format/scenario/fe_zone.rs`, which decides every op the same way.
 */

import type { FeDirection } from "../generated/FeDirection";
import type { FeKind } from "../generated/FeKind";
import type { FeZone } from "../generated/FeZone";
import type { SystemNode } from "../generated/SystemNode";
import type { Pt } from "./geometry/pt";

/** How far from its centre a zone reaches, in world units; the mod does not let it be resized. */
export const FE_ZONE_RADIUS = 30;

/** The distances the mod accepts between the anchor and the zone's centre. */
export const FE_ZONE_DISTANCES: readonly number[] = Array.from(
  { length: 18 },
  (_, i) => 30 + i * 10,
);

/** Where a new zone is put: the nearest distance whose ring clears the anchor's own star. */
export const FE_ZONE_DEFAULT_DISTANCE = 40;

/** The mod's canvas ends here on either axis; a ring past it is off the map. */
export const FE_ZONE_MAP_EXTENT = 470;

/** The eight compass directions in the mod's order, named as the user sees them on screen. */
export const FE_DIRECTIONS: ReadonlyArray<{ key: FeDirection; label: string }> = [
  { key: "e", label: "East" },
  { key: "se", label: "South-east" },
  { key: "s", label: "South" },
  { key: "sw", label: "South-west" },
  { key: "w", label: "West" },
  { key: "nw", label: "North-west" },
  { key: "n", label: "North" },
  { key: "ne", label: "North-east" },
];

/** The fallen empires the mod can seat. */
export const FE_KINDS: ReadonlyArray<{ key: FeKind; label: string }> = [
  { key: "random", label: "Random" },
  { key: "materialist", label: "Materialist" },
  { key: "spiritualist", label: "Spiritualist" },
  { key: "xenophobe", label: "Xenophobe" },
  { key: "xenophile", label: "Xenophile" },
  { key: "machine", label: "Machine" },
  { key: "hive", label: "Hive" },
];

const HALF_DIAGONAL = 1 / Math.SQRT2;

/** Unit offset from the anchor per direction in game coordinates: east lies at negative x. */
const UNIT: Record<FeDirection, Pt> = {
  e: { x: -1, y: 0 },
  se: { x: -HALF_DIAGONAL, y: HALF_DIAGONAL },
  s: { x: 0, y: 1 },
  sw: { x: HALF_DIAGONAL, y: HALF_DIAGONAL },
  w: { x: 1, y: 0 },
  nw: { x: HALF_DIAGONAL, y: -HALF_DIAGONAL },
  n: { x: 0, y: -1 },
  ne: { x: -HALF_DIAGONAL, y: -HALF_DIAGONAL },
};

export function feDirectionLabel(direction: FeDirection): string {
  return FE_DIRECTIONS.find((d) => d.key === direction)?.label ?? direction;
}

export function feKindLabel(kind: FeKind): string {
  return FE_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

/** The zone a new anchor gets: the mod's defaults, placed by hand. */
export function newFeZone(direction: FeDirection, distance = FE_ZONE_DEFAULT_DISTANCE): FeZone {
  return { direction, kind: "random", distance, preferred: true, fallback: false };
}

/** Where the ring's centre lies, in world units. */
export function feZoneCentre(anchor: Pt, zone: Pick<FeZone, "direction" | "distance">): Pt {
  const unit = UNIT[zone.direction];
  return { x: anchor.x + unit.x * zone.distance, y: anchor.y + unit.y * zone.distance };
}

/** The direction and distance whose centre lies nearest a world point, over the 8 × 18 grid. */
export function snapFeZone(anchor: Pt, point: Pt): { direction: FeDirection; distance: number } {
  let best = { direction: FE_DIRECTIONS[0].key, distance: FE_ZONE_DISTANCES[0] };
  let bestD2 = Infinity;
  for (const { key: direction } of FE_DIRECTIONS) {
    for (const distance of FE_ZONE_DISTANCES) {
      const c = feZoneCentre(anchor, { direction, distance });
      const d2 = (c.x - point.x) ** 2 + (c.y - point.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { direction, distance };
      }
    }
  }
  return best;
}

/** Whether the centre lies past the extent the core accepts: its `is_off_map`. */
export function feZoneOffMap(centre: Pt): boolean {
  return Math.abs(centre.x) > FE_ZONE_MAP_EXTENT || Math.abs(centre.y) > FE_ZONE_MAP_EXTENT;
}

/**
 * The first system the ring at `centre` would cover, or null when it is clear. The anchor sits
 * on the ring's edge at distance 30 and is never a blocker, as in the core's rule.
 */
export function feZoneBlocked(
  centre: Pt,
  systems: ReadonlyMap<number, SystemNode>,
  anchorId: number,
): SystemNode | null {
  for (const s of systems.values()) {
    if (s.id !== anchorId && covers(centre, s)) return s;
  }
  return null;
}

function covers(centre: Pt, s: Pt): boolean {
  return Math.hypot(s.x - centre.x, s.y - centre.y) < FE_ZONE_RADIUS;
}

/**
 * The first direction, in the mod's order, whose ring at the default distance is clear of every
 * system and on the map; null when the anchor is hemmed in on every side.
 */
export function firstFreeDirection(
  anchor: Pt & { id?: number },
  systems: ReadonlyMap<number, SystemNode>,
): FeDirection | null {
  const anchorId = anchor.id ?? -1;
  for (const { key: direction } of FE_DIRECTIONS) {
    const centre = feZoneCentre(anchor, { direction, distance: FE_ZONE_DEFAULT_DISTANCE });
    if (feZoneOffMap(centre)) continue;
    if (feZoneBlocked(centre, systems, anchorId) === null) return direction;
  }
  return null;
}

/** Why a ring cannot go where it was asked to, in the words the status bar shows. */
export function feZoneRefusal(blocked: SystemNode | null, name: (s: SystemNode) => string): string {
  return blocked === null
    ? "The ring would lie off the map."
    : `The ring would cover ${name(blocked)}. A fallen empire zone must be empty space.`;
}

/** Why a system cannot be given a second zone. */
export const ALREADY_ANCHORS = "This system already anchors a zone";

/** Why a system cannot be given a zone: every ring at the default distance would cover a system. */
export const NO_FREE_DIRECTION = "No clear space for a ring at distance 40";

/** Why a system cannot be given a zone by hand, or null when it can. */
export function addFeZoneRefusal(
  system: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): string | null {
  if (system.fe_zone !== null) return ALREADY_ANCHORS;
  if (firstFreeDirection(system, systems) === null) return NO_FREE_DIRECTION;
  return null;
}
