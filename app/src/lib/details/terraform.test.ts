import { describe, expect, it } from "vitest";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { terraformCandidateTitle } from "./terraform";

const CANDIDATES = new Map<string, TerraformCandidateView>(
  [
    { modifier: "terraforming_candidate", requires: ["Climate Restoration"] },
    {
      modifier: "frozen_terraforming_candidate",
      requires: ["Climate Restoration", "Hydrocentric"],
    },
    { modifier: "ash_terraforming_candidate", requires: [] },
  ].map((c) => [c.modifier, c]),
);

describe("terraformCandidateTitle", () => {
  it("names the one thing a candidate needs", () => {
    expect(terraformCandidateTitle("terraforming_candidate", CANDIDATES)).toBe(
      "Needs Climate Restoration to terraform",
    );
  });

  it("joins everything a candidate needs", () => {
    expect(terraformCandidateTitle("frozen_terraforming_candidate", CANDIDATES)).toBe(
      "Needs Climate Restoration and Hydrocentric to terraform",
    );
  });

  it("names nothing for a candidate that needs nothing, or one the install does not list", () => {
    expect(terraformCandidateTitle("ash_terraforming_candidate", CANDIDATES)).toBe(
      "Lets this planet be terraformed",
    );
    expect(terraformCandidateTitle("some_modded_candidate", CANDIDATES)).toBe(
      "Lets this planet be terraformed",
    );
  });
});
