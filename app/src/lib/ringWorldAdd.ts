/**
 * What the Add megastructure dialog says of a whole ring world: the stage each quadrant is added
 * at, and what clearing the system for it deletes.
 */
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";
import { counted } from "./text";

/** The quadrants, in the order the game spawns them. */
export const QUADRANTS = ["A", "B", "C", "D"] as const;

/** The stages a quadrant is offered at, as the grid's columns name them. */
export const RING_STAGES: readonly { stage: RingStage; label: string }[] = [
  { stage: "finished", label: "Finished" },
  { stage: "frame", label: "Frame" },
  { stage: "ruined", label: "Ruined" },
  { stage: "damaged", label: "Damaged" },
];

/** Every quadrant finished, as the dialog opens. */
export const ALL_FINISHED: readonly RingStage[] = QUADRANTS.map(() => "finished");

export const QUADRANTS_LABEL = "Quadrants";
export const SET_ALL = "Set all";
export const PLANETS_LABEL = "Planets";
export const LEAVE_PLANETS = "Keep";
export const CLEAR_PLANETS = "Clear system";
/** What the dialog says before Add of a whole ring world. */
export const RING_WRITTEN = "Finished sections are added with no colony.";
export const NOTHING_TO_CLEAR = "The system has no planets or belts to clear.";

/** `A`, `A and B`, `A, B and C`. */
export function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The warning before Add when the system is cleared: "Clearing deletes 6 planets, 2 moons and
 * 1 belt, and the colony on Lachium I." Each body is named by `nameOf`.
 */
export function clearingWarning(
  clearing: RingWorldClearing,
  nameOf: (body: number) => string,
): string {
  const planets = clearing.bodies.length - clearing.moons;
  const parts = [
    planets > 0 ? counted(planets, "planet") : null,
    clearing.moons > 0 ? counted(clearing.moons, "moon") : null,
    clearing.belts > 0 ? counted(clearing.belts, "belt") : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return NOTHING_TO_CLEAR;
  const colonies = clearing.colonies.map(nameOf);
  const structures = clearing.megastructures.map((row) => nameOf(row.body));
  const also = [
    colonies.length === 0
      ? null
      : `the ${colonies.length === 1 ? "colony" : "colonies"} on ${listed(colonies)}`,
    structures.length === 0
      ? null
      : `the ${structures.length === 1 ? "megastructure" : "megastructures"} on ${listed(structures)}`,
  ].filter((part) => part !== null);
  const alsoText = also.length === 0 ? "" : `, and ${also.join(" and ")}`;
  return `Clearing deletes ${listed(parts)}${alsoText}.`;
}

/**
 * Why the system can't be cleared: a starbase orbits a planet clearing would delete, which the
 * core refuses. Null when it can.
 */
export function clearRefusal(
  clearing: RingWorldClearing,
  nameOf: (body: number) => string,
): string | null {
  if (clearing.starbase_bodies.length === 0) return null;
  const bodies = listed(clearing.starbase_bodies.map(nameOf));
  return `Galaxy Forge can't clear this system: a starbase orbits ${bodies}, which clearing would delete.`;
}

/** Why Clear is off while the dialog reads what clearing deletes. */
export const CLEARING_LOADING = "Reading what clearing deletes…";

/** Why the dialog can't say what clearing deletes. */
export function clearingUnread(why: string): string {
  return `Couldn't read what clearing the system deletes: ${why}`;
}
