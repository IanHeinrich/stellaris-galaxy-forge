/** Whether a save body is a terraforming candidate, and the modifier that op controls. */
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { StarClassView } from "../../generated/StarClassView";
import { isStarBody } from "./starBody";

/** The game's own candidate modifiers, for a page shown before game data has loaded. */
const VANILLA_CANDIDATES: readonly string[] = [
  "terraforming_candidate",
  "frozen_terraforming_candidate",
  "toxic_terraforming_candidate",
];

/** What Climate Restoration needs besides itself, by the candidate modifier it unlocks. */
const EXTRA_TECH: Readonly<Record<string, string>> = {
  frozen_terraforming_candidate: "and Hydrocentric",
  toxic_terraforming_candidate: "and Detox",
};

/** The modifier a terraforming checkbox controls, and whether the planet carries it now. */
export interface TerraformCandidate {
  modifier: string;
  checked: boolean;
}

/** Every modifier some planet class can be a candidate by. */
function candidateModifiers(planetClasses: ReadonlyMap<string, PlanetClassView>): string[] {
  const found = new Set<string>();
  for (const pc of planetClasses.values()) {
    if (pc.terraform_candidate !== null) found.add(pc.terraform_candidate);
  }
  return found.size === 0 ? [...VANILLA_CANDIDATES] : [...found];
}

/**
 * The planet's terraforming candidate state: a candidate modifier it already carries, so one left
 * from an earlier class can still be cleared, or else its class's own. `null` when neither applies,
 * which is also when the block has nothing to show.
 */
export function terraformCandidate(
  page: PlanetPage,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): TerraformCandidate | null {
  const carries = (modifier: string) => page.timed_modifiers.some((m) => m.modifier === modifier);
  const carried = candidateModifiers(planetClasses).find(carries);
  if (carried !== undefined) return { modifier: carried, checked: true };
  const own = planetClasses.get(page.class)?.terraform_candidate ?? null;
  return own === null ? null : { modifier: own, checked: false };
}

/** What Climate Restoration needs to terraform a planet that carries `modifier`. */
export function terraformCandidateTitle(modifier: string): string {
  const extra = EXTRA_TECH[modifier];
  return extra === undefined
    ? "Needs Climate Restoration to terraform"
    : `Needs Climate Restoration ${extra} to terraform`;
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
