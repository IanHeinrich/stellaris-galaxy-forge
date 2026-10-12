/**
 * The op that deletes a save's ring world whole, which bodies and megastructures of a system
 * belong to one, and the sentence the confirm asks.
 */
import { RING_WORLD_ROW_PREFIXES, RING_WORLD_SEGMENT_PREFIXES } from "../../generated/constants";
import type { Op } from "../../generated/Op";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { SystemDetails } from "../../generated/SystemDetails";
import { counted } from "../text";
import { colonyParts } from "./planetRemoval";

export const DELETE_RING_WORLD = "Delete ring world";

/** The op that deletes every ring world of `system`. */
export function deleteRingWorldOp(system: number): Op {
  return { type: "DeleteRingWorld", system };
}

/** Whether a body of `planetClass` is a ring world segment. */
export function isRingSegment(planetClass: string): boolean {
  return RING_WORLD_SEGMENT_PREFIXES.some((prefix) => planetClass.startsWith(prefix));
}

/** Whether a megastructure of `kind` is part of a ring world. */
export function isRingRow(kind: string): boolean {
  return RING_WORLD_ROW_PREFIXES.some((prefix) => kind.startsWith(prefix));
}

/** What deleting the ring worlds of a system takes. */
export interface RingWorldParts {
  /** The segments and their moons. */
  planets: number[];
  /** Those of `planets` with a colony. */
  colonised: number[];
  /** The ring world megastructures. */
  rows: number[];
}

/** The parts of every ring world in `details`. */
export function ringWorldParts(details: SystemDetails): RingWorldParts {
  const going = new Set(details.planets.filter((p) => isRingSegment(p.class)).map((p) => p.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of details.planets) {
      if (p.parent !== null && going.has(p.parent) && !going.has(p.id)) {
        going.add(p.id);
        grew = true;
      }
    }
  }
  const planets = details.planets.filter((p) => going.has(p.id));
  return {
    planets: planets.map((p) => p.id),
    colonised: planets.filter((p) => p.colonised).map((p) => p.id),
    rows: details.megastructures.filter((m) => isRingRow(m.kind)).map((m) => m.id),
  };
}

/** A colony that goes with the ring: its planet's name and page. */
export interface RingColony {
  planet: string;
  page: PlanetPage;
}

/**
 * The confirm for deleting the ring world in the system named `system`, whose `planets`
 * planets go with `colonies` on them.
 */
export function deleteRingWorldQuestion(
  system: string,
  planets: number,
  colonies: readonly RingColony[],
): string {
  const removed =
    planets === 0
      ? "It is removed from the save."
      : `Its ${counted(planets, "planet")} ${planets === 1 ? "is" : "are"} removed from the save.`;
  return `Delete the ring world in ${system}? ${removed}${settled(colonies)}`;
}

/** What the confirm says of the colonies that go first. */
function settled(colonies: readonly RingColony[]): string {
  const [first, ...rest] = colonies;
  if (first === undefined) return "";
  if (rest.length === 0) {
    return ` The colony on ${first.planet} goes with it: ${colonyParts(first.page)}.`;
  }
  const names = colonies.map((c) => c.planet);
  const listed = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return ` The colonies on ${listed} go with it, with their pops, buildings and defence armies.`;
}
