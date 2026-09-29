/**
 * The edits a save body's page offers beside its star's: its name, its size, its deposits, its
 * modifiers, its dig site and its anomaly.
 */
import type { DigSiteChoice } from "../../generated/DigSiteChoice";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import type { ModifierLineView } from "../../generated/ModifierLineView";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { StarClassView } from "../../generated/StarClassView";
import { removalTarget } from "./depositWarnings";
import type { ModifierRow } from "./planetPage";
import { isStarBody } from "./starBody";

/** Days for an item that never runs out. */
export const PERMANENT = -1;

/** The remove button's hover text on a deposit a station works. */
export const STATION_STAYS =
  "Remove one. The station working it stays in game and still costs about 1 energy a month.";

/** The Size field's hover text on a colony. */
export const COLONY_SIZE =
  "Change the planet's size. Within a month the game demolishes districts over a lowered cap.";

/** The edit that renames planet `id` to `text`, trimmed; `null` for an empty or unchanged name. */
export function renamePlanetOp(id: number, current: string, text: string): Op | null {
  const name = text.trim();
  if (name === "" || name === current) return null;
  return { type: "RenameSavePlanet", planet: id, name };
}

export function addDepositOp(planet: number, kind: string): Op {
  return { type: "AddSaveDeposit", planet, kind };
}

/** The edit that adds `choice` to planet `planet` for `days`, or for ever when `null`. */
export function addModifierOp(planet: number, choice: ModifierChoice, days: number | null): Op {
  return {
    type: "AddPlanetModifier",
    planet,
    modifier: choice.modifier,
    days: [days ?? PERMANENT],
    ...(choice.feature === null ? {} : { feature: choice.feature }),
  };
}

/** The edit that takes a row of the page's Modifiers list off planet `planet`. */
export function removeModifierOp(planet: number, row: ModifierRow): Op {
  return {
    type: "RemovePlanetModifier",
    planet,
    modifier: row.modifier,
    ...(row.feature ? { feature: row.key } : {}),
  };
}

/** The edit that adds an anomaly of category `category` to planet `planet`. */
export function addAnomalyOp(planet: number, category: string): Op {
  return { type: "AddAnomaly", planet, category };
}

/** The edit that takes planet `planet`'s anomaly off it. */
export function removeAnomalyOp(planet: number): Op {
  return { type: "RemoveAnomaly", planet };
}

/** The edit that puts a dig site of `choice`'s type on planet `planet`, at its first stage. */
export function addDigSiteOp(planet: number, choice: DigSiteChoice): Op {
  return { type: "AddDigSite", planet, site_type: choice.key, difficulty: choice.difficulty };
}

/**
 * The edit that takes one deposit of type `kind` hiding `swapType` off the page's planet: its
 * last, passing over one being cleared while another is not.
 */
export function removeDepositOp(
  page: PlanetPage,
  kind: string,
  swapType: string | null,
): Op | null {
  const target = removalTarget(page, kind, swapType);
  return target === null ? null : { type: "RemoveSaveDeposit", deposit: target.id };
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
    : "Open this planet's page to rename it or change its modifiers, deposits and anomaly";
}
