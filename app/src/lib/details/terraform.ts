/** Whether a save body can be a terraforming candidate, and what being one needs. */
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { isStarBody } from "./starBody";

/**
 * Whether a planet is or can be a terraforming candidate: its class links to a candidate
 * modifier, or it still has one left over from an earlier class. `modifierKeys` are the
 * planet's permanent modifier names.
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
 * Why a body's row in a planet list has the Edit chip, as its hover text: a star's type and
 * size, or a planet that is or can be a terraforming candidate. `null` otherwise.
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
