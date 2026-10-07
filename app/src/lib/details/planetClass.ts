/**
 * The Class field of a save planet's page, and of the page of several selected bodies: the
 * classes the planets may take, with the colony and moon rules applied.
 */
import type { PlanetClassRule } from "../../generated/PlanetClassRule";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { GroupedRow } from "./picker";

/** The Class field's hover text. */
export const CLASS_TITLE = "Change this planet's class. Deposits, modifiers and any colony stay.";

/** The field's hover text when it changes several planets. */
export const CLASSES_TITLE =
  "Change the class of the selected planets. Deposits, modifiers and any colony stay.";

/** The line under the field. */
export const CLASS_LOOK_NOTE = "Changing the class resets the planet's look.";

/** The line under the field when it changes several planets. */
export const CLASSES_LOOK_NOTE = "Changing the class resets each planet's look.";

/** Why the field takes no pick. */
export const CLASSES_NEED_GAME_DATA = "Load game data to pick a class";
export const CLASS_FIXED = "This kind of planet keeps its class";
export const COLONY_CLASS_FIXED = "A colony on this class keeps it";
export const NO_SHARED_CLASS = "No class fits every selected planet";

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

/** What the Class field reads of a body. */
export interface ClassBody {
  class: string;
  colonised: boolean;
  moon: boolean;
}

/** Whether a body may become `view`: a class that changes, open to colonies for a colony, and to moons for a moon. */
function opensTo(view: PlanetClassView, body: ClassBody): boolean {
  if (view.change === "never" || view.look_only === true || view.hidden_model === true) {
    return false;
  }
  if (body.colonised && view.change !== "any") return false;
  return !body.moon || view.moonless !== true;
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
  return sharedClassRows([{ class: current, colonised, moon }], planetClasses, label);
}

/**
 * The classes every one of `bodies` may become, as `classRows` offers them to one body. A class
 * all of them have already is left out; one only some have stays, for the rest.
 */
export function sharedClassRows(
  bodies: readonly ClassBody[],
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  label: (key: string) => string,
): GroupedRow[] {
  if (bodies.length === 0) return [];
  const group = (view: PlanetClassView) => (view.habitable ? "Habitable" : "Other");
  return [...planetClasses.values()]
    .filter((c) => bodies.every((b) => opensTo(c, b)))
    .filter((c) => !bodies.every((b) => b.class === c.key))
    .map((c) => ({ key: c.key, label: label(c.key), group: group(c) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/**
 * The warning under a Class field for several bodies that names each colony and moon whose own
 * rule leaves a class out of the list the others would share: "Fewer classes: Meissa I is
 * colonised. Meissa IIa is a moon." `null` where none narrows it.
 */
export function fewerClassesWarning(
  bodies: readonly (ClassBody & { name: string })[],
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): string | null {
  const views = [...planetClasses.values()];
  const narrows = (index: number, freed: ClassBody) =>
    views.some(
      (c) =>
        !opensTo(c, bodies[index]) &&
        opensTo(c, freed) &&
        bodies.every((b, i) => i === index || opensTo(c, b)),
    );
  const reasons = bodies.flatMap((body, i) => [
    ...(body.colonised && narrows(i, { ...body, colonised: false })
      ? [`${body.name} is colonised.`]
      : []),
    ...(body.moon && narrows(i, { ...body, moon: false }) ? [`${body.name} is a moon.`] : []),
  ]);
  return reasons.length === 0 ? null : `Fewer classes: ${reasons.join(" ")}`;
}

/** What the core reads of a class to change a planet to or from it. */
export function classRule(view: PlanetClassView): PlanetClassRule {
  return { class: view.key, change: view.change, models: view.models };
}
