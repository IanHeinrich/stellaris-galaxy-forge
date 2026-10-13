/**
 * What the Add megastructure dialog says of a whole ring world: the stage each quadrant is added
 * at, and what clearing the system for it deletes.
 */
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";
import { counted, listed } from "./text";

/** The quadrants, in the order the game spawns them. */
export const QUADRANTS = ["A", "B", "C", "D"] as const;

const STAGE_LABELS: Record<RingStage, string> = {
  finished: "Finished",
  frame: "Frame",
  ruined: "Ruined",
  damaged: "Damaged",
  restored: "Restored",
};

/** The stages a quadrant is offered at, as the grid's columns name them; a restored ring is not. */
export const RING_STAGES: readonly { stage: RingStage; label: string }[] = (
  ["finished", "frame", "ruined", "damaged"] as const
).map((stage) => ({ stage, label: STAGE_LABELS[stage] }));

/** The stages of the grid a ring is offered at: those not in `refused`. */
export function offeredStages(refused: readonly RingStage[]): RingStage[] {
  return RING_STAGES.map(({ stage }) => stage).filter((stage) => !refused.includes(stage));
}

/** Every quadrant finished, as the dialog opens. */
export const ALL_FINISHED: readonly RingStage[] = QUADRANTS.map(() => "finished");

export const QUADRANTS_LABEL = "Quadrants";
export const SIZE_LABEL = "Size";
/** What the picks say under why a size's ring is refused, when another size's ring fits. */
export const OTHER_SIZE = "Pick another size.";
export const SET_ALL = "Set all";
export const PLANETS_LABEL = "Planets";
export const LEAVE_PLANETS = "Keep";
export const CLEAR_PLANETS = "Clear system";
/** What the dialog says before Add of a whole ring world. */
export const RING_WRITTEN = "Finished sections are added with no colony.";
export const NOTHING_TO_CLEAR = "The system has no planets or belts to clear.";

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
      : `the ${colonies.length === 1 ? "colony" : "colonies"} on ${listed(colonies, "and")}`,
    structures.length === 0
      ? null
      : `the ${structures.length === 1 ? "megastructure" : "megastructures"} on ${listed(structures, "and")}`,
  ].filter((part) => part !== null);
  const alsoText = also.length === 0 ? "" : `, and ${also.join(" and ")}`;
  return `Clearing deletes ${listed(parts, "and")}${alsoText}.`;
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
  const bodies = listed(clearing.starbase_bodies.map(nameOf), "and");
  return `Galaxy Forge can't clear this system: a starbase orbits ${bodies}, which clearing would delete.`;
}

/** Why Clear is off while the dialog reads what clearing deletes. */
export const CLEARING_LOADING = "Checking what clearing deletes…";

/** Why the dialog can't say what clearing deletes. */
export function clearingUnread(why: string): string {
  return `Couldn't check what clearing the system deletes: ${why}`;
}
