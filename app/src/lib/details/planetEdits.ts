/**
 * The words a save body's page uses beside its edits, and which bodies a planet list marks as
 * editable. `store/planetEditAdapter` builds the edits themselves.
 */
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody } from "./starBody";

/** Days for an item that never runs out. */
export const PERMANENT = -1;

/** The remove button's hover text on a deposit a station works. */
export const STATION_STAYS =
  "Remove one. The station working it stays in game and still costs about 1 energy a month.";

/** The Size field's hover text on a colony. */
export const COLONY_SIZE =
  "Change the planet's size. Within a month the game demolishes districts over a lowered cap.";

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
    : "Open this planet's page to rename it or change its modifiers, deposits and anomaly";
}
