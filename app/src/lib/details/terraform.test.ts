import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { planetClassView } from "../../test/builders";
import { hasTerraformCheckbox, terraformCandidateTitle } from "./terraform";

const CLASSES = new Map<string, PlanetClassView>(
  [
    planetClassView("pc_barren", false, "terraforming_candidate"),
    planetClassView("pc_frozen", false, "frozen_terraforming_candidate"),
    planetClassView("pc_toxic", false, "toxic_terraforming_candidate"),
    planetClassView("pc_continental", false),
    planetClassView("pc_g_star", true),
  ].map((c) => [c.key, c]),
);

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

describe("hasTerraformCheckbox", () => {
  it("is true for a class with its own candidate, whatever the planet carries", () => {
    expect(hasTerraformCheckbox("pc_barren", [], CLASSES, CANDIDATES)).toBe(true);
  });

  it("is true for a planet carrying a candidate modifier left from another class", () => {
    expect(
      hasTerraformCheckbox("pc_continental", ["terraforming_candidate"], CLASSES, CANDIDATES),
    ).toBe(true);
  });

  it("is false for a class with no link and no carried candidate modifier", () => {
    expect(hasTerraformCheckbox("pc_continental", [], CLASSES, CANDIDATES)).toBe(false);
    expect(hasTerraformCheckbox("pc_continental", null, CLASSES, CANDIDATES)).toBe(false);
    expect(hasTerraformCheckbox("pc_continental", undefined, CLASSES, CANDIDATES)).toBe(false);
  });
});

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
