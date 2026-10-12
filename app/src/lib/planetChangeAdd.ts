/**
 * What the Add megastructure dialog says of a type whose build changes its planet's class or
 * size: the choice to change the planet as the game does or keep it, and what the add changes.
 */
import type { MegastructurePlanetChange } from "../generated/MegastructurePlanetChange";
import type { MegastructureView } from "../generated/MegastructureView";
import { bodyClassName } from "./details/labels";
import type { MegastructureSpot } from "./megastructurePicks";
import type { Names } from "./names";

export const PLANET_CHANGE_LABEL = "Planet";
/** The planet's class when the spot doesn't say it. */
const UNKNOWN_CLASS = "its class";

/** The change type `type` makes to the planet at `spot`; null for a type that makes none, or off a planet. */
export function planetChangeAt(
  type: MegastructureView | undefined,
  spot: MegastructureSpot,
): MegastructurePlanetChange | null {
  if (type === undefined || spot.kind !== "body" || spot.star) return null;
  return type.planet_change;
}

/** What the planet becomes: `Gaia World`, `size 6`, `Gaia World, size 6`. */
export function changedTo(change: MegastructurePlanetChange, names: Names): string {
  const parts = [
    ...(change.class === null ? [] : [bodyClassName(change.class, names)]),
    ...(change.size === null ? [] : [`size ${change.size}`]),
  ];
  return parts.join(", ");
}

/** The choice that changes the planet: "Change to Food Giant (as the game does)". */
export function changePlanetText(change: MegastructurePlanetChange, names: Names): string {
  return `Change to ${changedTo(change, names)} (as the game does)`;
}

/** The choice that keeps the planet: "Keep Gas Giant", or "Keep its size" for a size change. */
export function keepPlanetText(
  change: MegastructurePlanetChange,
  planetClass: string | null | undefined,
  names: Names,
): string {
  if (change.class === null) return "Keep its size";
  return `Keep ${planetClass ? bodyClassName(planetClass, names) : UNKNOWN_CLASS}`;
}

/** What the dialog says before Add when the planet changes: "Kepler I becomes a Food Giant." */
export function planetChangeNote(
  planet: string,
  change: MegastructurePlanetChange,
  names: Names,
): string {
  if (change.class === null) return `${planet} becomes ${changedTo(change, names)}.`;
  return `${planet} becomes ${article(changedTo(change, names))}.`;
}

/** What the dialog says before Add when the planet is kept. */
export const PLANET_KEPT_NOTE = "The planet keeps its class and size.";

function article(text: string): string {
  return /^[aeiou]/i.test(text) ? `an ${text}` : `a ${text}`;
}
