/**
 * Moving save planets between systems: where a click in the system view places a lone planet,
 * and every sentence the menus, the bar and the inspector say about a cut and its paste. Names
 * come in resolved.
 */

import type { OrbitPlacement } from "../generated/OrbitPlacement";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import type { PlanetRefusal } from "../generated/PlanetRefusal";
import { wrapDegrees } from "./details/orbits";
import { counted } from "./text";

/** A cut planet as the copy names it: a moon cut without its planet arrives as a planet. */
export interface MovedPlanet {
  name: string;
  moon: boolean;
}

/** The names a warning reads out, by id. */
export interface WarningNames {
  planet(id: number): string;
  country(id: number): string;
}

/** Where a planet pasted at the system-view point (x, y), relative to the centre, goes. */
export function placementAt(x: number, y: number): OrbitPlacement {
  return {
    radius: Math.round(Math.hypot(x, y)),
    angle: Math.round(wrapDegrees((Math.atan2(y, x) * 180) / Math.PI)) % 360,
  };
}

/** `orbit 108 · 20°`. */
export function orbitText(at: OrbitPlacement): string {
  return `orbit ${Math.round(at.radius)} · ${Math.round(wrapDegrees(at.angle)) % 360}°`;
}

/** `first`, and how many others stand behind it: `… (and 2 more)`. */
export function andMore(first: string, total: number): string {
  return total > 1 ? `${first} (and ${total - 1} more)` : first;
}

/** What the planets are called: the one planet's name, else the count. */
function what(planets: readonly MovedPlanet[]): string {
  return planets.length === 1 ? planets[0].name : counted(planets.length, "planet");
}

/** ` as a planet` when the one planet cut is a moon. */
function asPlanet(planets: readonly MovedPlanet[]): string {
  return planets.length === 1 && planets[0].moon ? " as a planet" : "";
}

/** The Cut item and button: `Cut 3 planets`. */
export function cutLabel(count: number): string {
  return `Cut ${counted(count, "planet")}`;
}

/** The bar while planets are cut: `Moving 3 planets from Meissa`. */
export function movingLabel(planets: readonly MovedPlanet[], from: string): string {
  return `Moving ${what(planets)} from ${from}${asPlanet(planets)}`;
}

/**
 * The Paste item: `Paste 3 planets here`; a lone planet at a clicked point gives the orbit,
 * `Paste Meissa II here (orbit 108 · 20°)`, and a lone moon says it arrives as a planet.
 */
export function pasteLabel(planets: readonly MovedPlanet[], at?: OrbitPlacement | null): string {
  const place = at && planets.length === 1 ? ` (${orbitText(at)})` : "";
  return `Paste ${what(planets)} here${asPlanet(planets)}${place}`;
}

/** What the game does with one colony or station the move takes into another empire's system. */
export function warningText(warning: PlanetMoveWarning, names: WarningNames): string {
  const planet = names.planet(warning.planet);
  const country = names.country(warning.new_owner);
  return warning.kind === "colony"
    ? `${planet} will pass to the ${country} about a month after you load`
    : `${planet}'s station will pass to the ${country}`;
}

/** Every warning, one line each, as the hover lists them. */
export function warningLines(
  warnings: readonly PlanetMoveWarning[],
  names: WarningNames,
): string[] {
  return warnings.map((w) => warningText(w, names));
}

/** The line under Paste: the first warning and how many more; null with none. */
export function warningLine(
  warnings: readonly PlanetMoveWarning[],
  names: WarningNames,
): string | null {
  return warnings.length === 0 ? null : andMore(warningText(warnings[0], names), warnings.length);
}

/** Why a set cannot be cut: the first refusal and how many more; null with none. */
export function refusalLine(refused: readonly PlanetRefusal[]): string | null {
  return refused.length === 0 ? null : andMore(refused[0].reason, refused.length);
}
