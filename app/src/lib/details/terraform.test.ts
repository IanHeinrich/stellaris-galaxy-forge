import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import { name, planetClassView } from "../../test/builders";
import { setTerraformCandidateOp, terraformCandidate, terraformCandidateTitle } from "./terraform";

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

describe("terraformCandidate", () => {
  it("is the class's modifier, unchecked, for an eligible planet without it", () => {
    expect(terraformCandidate(page("pc_barren"), CLASSES)).toEqual({
      modifier: "terraforming_candidate",
      checked: false,
    });
  });

  it("is checked once the planet carries the class's modifier", () => {
    expect(terraformCandidate(page("pc_barren", ["terraforming_candidate"]), CLASSES)).toEqual({
      modifier: "terraforming_candidate",
      checked: true,
    });
  });

  it("maps a frozen class to the frozen modifier", () => {
    expect(terraformCandidate(page("pc_frozen"), CLASSES)?.modifier).toBe(
      "frozen_terraforming_candidate",
    );
  });

  it("is nothing for a class with no terraform link and no modifier carried", () => {
    expect(terraformCandidate(page("pc_continental"), CLASSES)).toBeNull();
  });

  it("is nothing for a star class, which the game never gives a terraform link", () => {
    expect(terraformCandidate(page("pc_g_star"), CLASSES)).toBeNull();
  });

  it("falls back to a stale modifier the planet still carries after its class changed", () => {
    expect(terraformCandidate(page("pc_continental", ["terraforming_candidate"]), CLASSES)).toEqual(
      { modifier: "terraforming_candidate", checked: true },
    );
  });

  it("offers a stale modifier of another class first, so it can be cleared", () => {
    expect(
      terraformCandidate(page("pc_barren", ["frozen_terraforming_candidate"]), CLASSES),
    ).toEqual({ modifier: "frozen_terraforming_candidate", checked: true });
  });

  it("recognises a mod's candidate modifier left on a planet of another class", () => {
    const modded = new Map(CLASSES);
    modded.set("pc_ash", planetClassView("pc_ash", false, "ash_terraforming_candidate"));
    expect(
      terraformCandidate(page("pc_continental", ["ash_terraforming_candidate"]), modded),
    ).toEqual({ modifier: "ash_terraforming_candidate", checked: true });
  });

  it("is nothing without game data unless the planet already carries a candidate modifier", () => {
    expect(terraformCandidate(page("pc_barren"), new Map())).toBeNull();
    expect(terraformCandidate(page("pc_barren", ["terraforming_candidate"]), new Map())).toEqual({
      modifier: "terraforming_candidate",
      checked: true,
    });
  });
});

describe("terraformCandidateTitle", () => {
  it("names Climate Restoration alone for the plain candidate", () => {
    expect(terraformCandidateTitle("terraforming_candidate")).toBe(
      "Needs Climate Restoration to terraform",
    );
  });

  it("names the extra tech the frozen and toxic candidates also need", () => {
    expect(terraformCandidateTitle("frozen_terraforming_candidate")).toBe(
      "Needs Climate Restoration and Hydrocentric to terraform",
    );
    expect(terraformCandidateTitle("toxic_terraforming_candidate")).toBe(
      "Needs Climate Restoration and Detox to terraform",
    );
  });

  it("falls back to Climate Restoration alone for any other modifier", () => {
    expect(terraformCandidateTitle("some_modded_candidate")).toBe(
      "Needs Climate Restoration to terraform",
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
