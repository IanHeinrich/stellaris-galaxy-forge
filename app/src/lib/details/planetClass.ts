/**
 * The Class field of a save planet's page: the classes the planet may take, with the colony rules
 * applied.
 */
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { GroupedRow } from "./picker";

/** The Class field's hover text. */
export const CLASS_TITLE = "Change this planet's class. Deposits, modifiers and any colony stay.";

/** The line under the field. */
export const CLASS_LOOK_NOTE = "Changing the class resets the planet's look.";

/** Why the field takes no pick. */
export const CLASSES_NEED_GAME_DATA = "Load game data to pick a class";
export const CLASS_FIXED = "This kind of planet keeps its class";
export const COLONY_CLASS_FIXED = "A colony on this class keeps it";

/** Why a planet of `current` cannot change class, or `null` when it can. */
export function classFieldReason(
  current: string,
  colonised: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): string | null {
  if (planetClasses.size === 0) return CLASSES_NEED_GAME_DATA;
  const view = planetClasses.get(current);
  if (view === undefined || view.change === "never") return CLASS_FIXED;
  if (colonised && view.change !== "any") return COLONY_CLASS_FIXED;
  return null;
}

/**
 * The classes a planet of `current` may become: none where it keeps its own, for a colony only
 * those open to colonies, and for a moon none that cannot be one. A class mods only use as a
 * planet's look, or one whose model draws nothing, is never offered. Habitable classes come
 * first, each group by name.
 */
export function classRows(
  current: string,
  colonised: boolean,
  moon: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  label: (key: string) => string,
): GroupedRow[] {
  if (classFieldReason(current, colonised, planetClasses) !== null) return [];
  const group = (view: PlanetClassView) => (view.habitable ? "Habitable" : "Other");
  return [...planetClasses.values()]
    .filter((c) => c.key !== current && c.change !== "never")
    .filter((c) => c.look_only !== true && c.hidden_model !== true)
    .filter((c) => !colonised || c.change === "any")
    .filter((c) => !moon || c.moonless !== true)
    .map((c) => ({ key: c.key, label: label(c.key), group: group(c) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}
