/** Whether a save body is a terraforming candidate, and the modifier that op controls. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { StarClassView } from "../../generated/StarClassView";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { isStarBody } from "./starBody";

/** The modifier a terraforming checkbox controls, and whether the planet carries it now. */
export interface TerraformCandidate {
  modifier: string;
  checked: boolean;
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
  const carried = page.timed_modifiers.find((m) => candidates.has(m.modifier))?.modifier;
  if (carried !== undefined) return { modifier: carried, checked: true };
  const own = planetClasses.get(page.class)?.terraform_candidate ?? null;
  return own === null ? null : { modifier: own, checked: false };
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
 * size, or a planet that can be made a terraforming candidate. `null` when its page edits nothing.
 */
export function bodyEditHint(
  planetClass: string,
  bodies: boolean,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  starClasses: ReadonlyMap<string, StarClassView>,
): string | null {
  if (!bodies) return null;
  if (isStarBody(planetClass, planetClasses, starClasses)) {
    return "Open this star's page to change its type and size";
  }
  if ((planetClasses.get(planetClass)?.terraform_candidate ?? null) !== null) {
    return "Open this planet's page to make it a terraforming candidate";
  }
  return null;
}

/** The edit that adds or removes a terraforming candidate modifier on planet `id`. */
export function setTerraformCandidateOp(id: number, modifier: string, on: boolean): Op {
  return { type: "SetTerraformCandidate", id, modifier, on };
}
