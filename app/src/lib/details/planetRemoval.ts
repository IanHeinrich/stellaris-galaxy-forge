/**
 * The ops that delete a save body or remove its colony, and the sentences their confirms ask.
 */
import type { Op } from "../../generated/Op";
import type { PlanetPage } from "../../generated/PlanetPage";
import { counted, thousands } from "../text";

/** The action's name: a moon is deleted as a moon. */
export function deleteLabel(moon: boolean): string {
  return moon ? "Delete moon" : "Delete planet";
}

export const REMOVE_COLONY = "Remove colony";

export function deleteOp(planet: number): Op {
  return { type: "DeleteSavePlanet", planet };
}

export function removeColonyOp(planet: number): Op {
  return { type: "RemoveColony", planet };
}

/** What goes with the colony on `page`, as one clause: its pops, buildings, armies and ring. */
function colonyParts(page: PlanetPage): string {
  const colony = page.colony;
  if (colony === null) return "";
  const buildings = colony.buildings.length;
  const pops = counted(colony.pops, "pop");
  const built = buildings === 0 ? "" : `, ${counted(buildings, "building")}`;
  return `${colony.pops === 1 ? pops : `${thousands(colony.pops)} pops`}${built}, its defence armies and any orbital ring`;
}

/** The confirm for deleting the body `page` shows, named `name`, with its moons. */
export function deleteQuestion(page: PlanetPage, name: string, moon: boolean): string {
  const moons = page.moons.length;
  const what = moons === 0 ? name : `${name} and its ${counted(moons, "moon")}`;
  const kind = moon ? "moon" : "planet";
  if (page.colony === null) return `Delete ${what}? The ${kind} is removed from the save.`;
  return `Delete ${what}? Its colony goes with it: ${colonyParts(page)}.`;
}

/** The confirm for removing the colony on the body `page` shows, named `name`. */
export function removeColonyQuestion(page: PlanetPage, name: string): string {
  return `Remove the colony on ${name}? It goes with ${colonyParts(page)}. The planet stays, with no owner.`;
}
