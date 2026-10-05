import { describe, expect, it } from "vitest";
import type { ModifierCategory } from "../../generated/ModifierCategory";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import { addedModifierLine, modifierPickRows, modifierSections, parseDays } from "./modifierPicker";

function choice(
  modifier: string,
  name: string,
  category: ModifierCategory,
  feature: string | null = null,
): ModifierChoice {
  return {
    modifier,
    feature,
    category,
    description: `${name} described`,
    view: {
      key: feature ?? modifier,
      name,
      static_modifier: modifier,
      icon: null,
      icon_frame: null,
      effects: [{ key: "planet_stability_add", value: 5, text: "+5 Stability" }],
    },
  };
}

const CHOICES = [
  choice("mineral_poor", "Mineral Poor", "Feature", "pm_mineral_poor"),
  choice("terraforming_candidate", "Terraforming Candidate", "Terraforming"),
  choice("frozen_terraforming_candidate", "Frozen Candidate", "Terraforming"),
  choice("holy_planet", "Holy World", "Positive"),
  choice("toxic_spill", "Toxic Spill", "Negative"),
];

const needs = (m: string) => `Needs research for ${m}`;

describe("modifierPickRows", () => {
  const has = ["pm_mineral_poor", "holy_planet"];
  const rows = modifierPickRows(CHOICES, has, "terraforming_candidate", needs);

  it("lists every choice by name, marking the ones the planet has and its class's candidate", () => {
    expect(rows.map((r) => [r.key, r.held, r.usual])).toEqual([
      ["frozen_terraforming_candidate", false, false],
      ["holy_planet", true, false],
      ["pm_mineral_poor", true, false],
      ["terraforming_candidate", false, true],
      ["toxic_spill", false, false],
    ]);
  });

  it("describes a candidate with what terraforming needs", () => {
    const candidate = rows.find((r) => r.key === "terraforming_candidate")!;
    expect(candidate.description).toBe(
      "Terraforming Candidate described\n\nNeeds research for terraforming_candidate",
    );
    expect(candidate.effects).toEqual(["+5 Stability"]);
  });

  it("filters by category and by effect, and lists all as one when none is usual", () => {
    expect(modifierSections(rows, "Feature", "")[0].rows.map((r) => r.key)).toEqual([
      "pm_mineral_poor",
    ]);
    expect(modifierSections(rows, "Negative", "stability")[0].rows.map((r) => r.key)).toEqual([
      "toxic_spill",
    ]);
    expect(modifierSections(rows, "Positive", "no such thing")).toEqual([]);
    expect(
      modifierSections(modifierPickRows(CHOICES, has, null, needs), "All", "").map((s) => s.title),
    ).toEqual([""]);
  });

  it("says what was added and reads a days field", () => {
    const plain = modifierPickRows(CHOICES, [], null, needs);
    expect(addedModifierLine(plain[1], null)).toBe("Added Holy World");
    expect(addedModifierLine(plain[1], 1)).toBe("Added Holy World for 1 day");
    expect([
      parseDays("360"),
      parseDays(" 12 "),
      parseDays("0"),
      parseDays("1.5"),
      parseDays("x"),
    ]).toEqual([360, 12, null, null, null]);
  });
});
