/** What making a save body a terraforming candidate needs. */
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";

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
