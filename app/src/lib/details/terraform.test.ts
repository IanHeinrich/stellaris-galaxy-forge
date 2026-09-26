import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { TerraformCandidateView } from "../../generated/TerraformCandidateView";
import { name, planetClassView } from "../../test/builders";
import {
  hasTerraformCheckbox,
  setTerraformCandidateOp,
  terraformCandidate,
  terraformCandidateTitle,
} from "./terraform";

/** A minimal save body page for class `planetClass`, carrying `modifiers` as permanent ones. */
function page(planetClass: string, modifiers: string[] = []): PlanetPage {
  return {
    id: 12,
    name: name("NAME_Test_Planet"),
    name_key: "",
    label: "",
    class: planetClass,
    size: 15,
    orbit: null,
    system: null,
    parent: null,
    moons: [],
    deposits: [],
    planet_modifiers: [],
    timed_modifiers: modifiers.map((modifier) => ({ modifier, days: -1 })),
    surveyed_by: null,
    station: null,
    owner: null,
    controller: null,
    colony: null,
    flags: 0,
  };
}

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

describe("terraformCandidate", () => {
  it("is the class's modifier, unchecked, for an eligible planet without it", () => {
    expect(terraformCandidate(page("pc_barren"), CLASSES, CANDIDATES)).toEqual({
      modifier: "terraforming_candidate",
      checked: false,
    });
  });

  it("is checked once the planet carries the class's modifier", () => {
    expect(
      terraformCandidate(page("pc_barren", ["terraforming_candidate"]), CLASSES, CANDIDATES),
    ).toEqual({
      modifier: "terraforming_candidate",
      checked: true,
    });
  });

  it("maps a frozen class to the frozen modifier", () => {
    expect(terraformCandidate(page("pc_frozen"), CLASSES, CANDIDATES)?.modifier).toBe(
      "frozen_terraforming_candidate",
    );
  });

  it("is nothing for a class with no terraform link and no modifier carried", () => {
    expect(terraformCandidate(page("pc_continental"), CLASSES, CANDIDATES)).toBeNull();
  });

  it("is nothing for a star class, which the game never gives a terraform link", () => {
    expect(terraformCandidate(page("pc_g_star"), CLASSES, CANDIDATES)).toBeNull();
  });

  it("falls back to a stale modifier the planet still carries after its class changed", () => {
    expect(
      terraformCandidate(page("pc_continental", ["terraforming_candidate"]), CLASSES, CANDIDATES),
    ).toEqual({ modifier: "terraforming_candidate", checked: true });
  });

  it("offers a stale modifier of another class first, so it can be cleared", () => {
    expect(
      terraformCandidate(page("pc_barren", ["frozen_terraforming_candidate"]), CLASSES, CANDIDATES),
    ).toEqual({ modifier: "frozen_terraforming_candidate", checked: true });
  });

  it("recognises a mod's candidate modifier left on a planet of another class", () => {
    const modded = new Map(CLASSES);
    modded.set("pc_ash", planetClassView("pc_ash", false, "ash_terraforming_candidate"));
    expect(
      terraformCandidate(
        page("pc_continental", ["ash_terraforming_candidate"]),
        modded,
        CANDIDATES,
      ),
    ).toEqual({ modifier: "ash_terraforming_candidate", checked: true });
  });

  it("is nothing without game data, even for a planet with a candidate modifier", () => {
    expect(terraformCandidate(page("pc_barren"), new Map(), new Map())).toBeNull();
    expect(
      terraformCandidate(page("pc_barren", ["terraforming_candidate"]), new Map(), new Map()),
    ).toBeNull();
  });

  it("is nothing for a temporary candidate modifier, which the op refuses to clear", () => {
    const temporary: PlanetPage = {
      ...page("pc_continental"),
      timed_modifiers: [{ modifier: "terraforming_candidate", days: 120 }],
    };
    expect(terraformCandidate(temporary, CLASSES, CANDIDATES)).toBeNull();
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

describe("setTerraformCandidateOp", () => {
  it("builds the op that adds or removes the modifier", () => {
    expect(setTerraformCandidateOp(12, "terraforming_candidate", true)).toEqual({
      type: "SetTerraformCandidate",
      id: 12,
      modifier: "terraforming_candidate",
      on: true,
    });
    expect(setTerraformCandidateOp(12, "terraforming_candidate", false)).toEqual({
      type: "SetTerraformCandidate",
      id: 12,
      modifier: "terraforming_candidate",
      on: false,
    });
  });
});
