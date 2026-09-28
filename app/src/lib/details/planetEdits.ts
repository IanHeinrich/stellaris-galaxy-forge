/** The edits a save body's page offers beside its star's: its name, its size and its deposits. */
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody } from "./starBody";

/** The remove button's hover text on a deposit a station works. */
export const STATION_STAYS =
  "Remove one. The station working it stays in game and still costs about 1 energy a month.";

/** Whether nobody owns the body: the game lets only such a body's size and deposits change here. */
export function uncolonised(page: PlanetPage): boolean {
  return page.owner === null && page.colony === null;
}

/** The edit that renames planet `id` to `text`, trimmed; `null` for an empty or unchanged name. */
export function renamePlanetOp(id: number, current: string, text: string): Op | null {
  const name = text.trim();
  if (name === "" || name === current) return null;
  return { type: "RenameSavePlanet", planet: id, name };
}

export function addDepositOp(planet: number, kind: string): Op {
  return { type: "AddSaveDeposit", planet, kind };
}

/** The edit that takes one deposit of type `kind` hiding `swapType` off the page's planet: its last. */
export function removeDepositOp(
  page: PlanetPage,
  kind: string,
  swapType: string | null,
): Op | null {
  const ids = page.deposits
    .filter((d) => d.kind === kind && d.swap_type === swapType)
    .map((d) => d.id);
  const last = ids[ids.length - 1];
  return last === undefined ? null : { type: "RemoveSaveDeposit", deposit: last };
}

/** One effect of a deposit type as the picker words it: a lost district as what it blocks. */
export function effectText(effect: ModifierLineView): string {
  if (effect.key === "planet_max_districts_add" && effect.value < 0) {
    const n = -effect.value;
    return `Blocks ${n} ${n === 1 ? "district" : "districts"}`;
  }
  return effect.text;
}

/**
 * Why a body's row in a planet list has the Edit chip, as its hover text: a star's type and
 * size, or any other body's name, modifiers and deposits. `null` where bodies cannot be edited.
 */
export function bodyEditHint(
  planetClass: string,
  bodies: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): string | null {
  if (!bodies) return null;
  return isStarBody(planetClass, planetClasses, starClasses)
    ? "Open this star's page to change its type and size"
    : "Open this planet's page to rename it or change its modifiers and deposits";
}
