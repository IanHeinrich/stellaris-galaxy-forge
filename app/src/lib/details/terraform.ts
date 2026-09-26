/** Whether a save body is a terraforming candidate, and the modifier that op controls. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { PlanetPageTimedModifier } from "../../generated/PlanetPageTimedModifier";
import type { StarClassView } from "../../generated/StarClassView";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { isStarBody } from "./starBody";

/** The modifier a terraforming checkbox controls, and whether the planet carries it now. */
export interface TerraformCandidate {
  modifier: string;
  checked: boolean;
}

/** Days left on a `timed_modifier` item that never runs out. */
const PERMANENT = -1;

/** The names among a planet's permanent timed modifiers (`days === -1`): a temporary one is
 * never a candidate, since the op that would clear it refuses anything but a permanent modifier. */
function permanentModifierKeys(modifiers: readonly PlanetPageTimedModifier[]): string[] {
  return modifiers.filter((m) => m.days === PERMANENT).map((m) => m.modifier);
}

/**
 * Whether a planet's page shows the Terraforming checkbox: its class links to a candidate
 * modifier, or it still carries one left over from an earlier class. `modifierKeys` are the
 * planet's permanent modifier names. The one rule a planet list's row and the planet's own
 * page both read, so a leftover modifier keeps its Edit chip in step with its checkbox.
 */
export function hasTerraformCheckbox(
  planetClass: string,
  modifierKeys: readonly string[] | null | undefined,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  candidates: ReadonlyMap<string, TerraformCandidateView>,
): boolean {
  return (
    (modifierKeys ?? []).some((key) => candidates.has(key)) ||
    (planetClasses.get(planetClass)?.terraform_candidate ?? null) !== null
  );
}

/**
 * The planet's terraforming candidate state: a candidate modifier it already carries, so one left
 * from an earlier class can still be cleared, or else its class's own. `null` when neither applies,
 * which is also when the block has nothing to show.
 */
export function terraformCandidate(
  page: PlanetPage,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  candidates: ReadonlyMap<string, TerraformCandidateView>,
): TerraformCandidate | null {
  const modifierKeys = permanentModifierKeys(page.timed_modifiers);
  if (!hasTerraformCheckbox(page.class, modifierKeys, planetClasses, candidates)) return null;
  const carried = modifierKeys.find((key) => candidates.has(key));
  if (carried !== undefined) return { modifier: carried, checked: true };
  // hasTerraformCheckbox passed above with no carried modifier, so the class links to one.
  return { modifier: planetClasses.get(page.class)!.terraform_candidate!, checked: false };
}

/** What terraforming a planet that has `modifier` needs, by the names the install gives them. */
export function terraformCandidateTitle(
  modifier: string,
  candidates: ReadonlyMap<string, TerraformCandidateView>,
): string {
  const requires = candidates.get(modifier)?.requires ?? [];
  if (requires.length === 0) return "Lets this planet be terraformed";
  const last = requires[requires.length - 1];
  const names = requires.length === 1 ? last : `${requires.slice(0, -1).join(", ")} and ${last}`;
  return `Needs ${names} to terraform`;
}

/**
 * Why a body's row in a planet list carries the Edit chip, as its hover text: a star's type and
 * size, or a planet whose page shows the Terraforming checkbox. `null` when its page edits
 * nothing.
 */
export function bodyEditHint(
  planetClass: string,
  bodies: boolean,
  modifierKeys: readonly string[] | null | undefined,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
  candidates: ReadonlyMap<string, TerraformCandidateView>,
): string | null {
  if (!bodies) return null;
  if (isStarBody(planetClass, planetClasses, starClasses)) {
    return "Open this star's page to change its type and size";
  }
  if (!hasTerraformCheckbox(planetClass, modifierKeys, planetClasses, candidates)) return null;
  return (modifierKeys ?? []).some((key) => candidates.has(key))
    ? "Open this planet's page to clear its terraforming candidate"
    : "Open this planet's page to make it a terraforming candidate";
}

/** The edit that adds or removes a terraforming candidate modifier on planet `id`. */
export function setTerraformCandidateOp(id: number, modifier: string, on: boolean): Op {
  return { type: "SetTerraformCandidate", id, modifier, on };
}
