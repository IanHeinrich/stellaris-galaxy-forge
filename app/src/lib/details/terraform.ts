/** What making a save body a terraforming candidate needs. */
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { listed } from "../text";

/** What terraforming a planet that has `modifier` needs, by the names the install gives them. */
export function terraformCandidateTitle(
  modifier: string,
  candidates: ReadonlyMap<string, TerraformCandidateView>,
): string {
  const requires = candidates.get(modifier)?.requires ?? [];
  if (requires.length === 0) return "Lets this planet be terraformed";
  return `Needs ${listed(requires, "and")} to terraform`;
}
