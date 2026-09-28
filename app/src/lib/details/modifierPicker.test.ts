import { describe, expect, it } from "vitest";
import type { ModifierCategory } from "../../generated/ModifierCategory";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import { planetPage } from "../../test/builders";
import {
  addedModifierLine,
  addModifierOp,
  modifierPickRows,
  modifierSections,
  parseDays,
  removeModifierOp,
} from "./modifierPicker";
import { modifierRows } from "./planetPage";

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
  const page = planetPage({
    planet_modifiers: ["pm_mineral_poor"],
    timed_modifiers: [{ modifier: "holy_planet", days: 120 }],
  });
  const rows = modifierPickRows(CHOICES, page, "terraforming_candidate", needs);

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
    expect(candidate.gives).toBe("+5 Stability");
  });

  it("puts the usual rows first under All, and filters by chip and search", () => {
    expect(modifierSections(rows, "All", "").map((s) => [s.title, s.rows.length])).toEqual([
      ["Usual for this planet", 1],
      ["Everything else", 4],
    ]);
    expect(modifierSections(rows, "Feature", "")[0].rows.map((r) => r.key)).toEqual([
      "pm_mineral_poor",
    ]);
    expect(modifierSections(rows, "Negative", "stability")[0].rows.map((r) => r.key)).toEqual([
      "toxic_spill",
    ]);
    expect(modifierSections(rows, "Positive", "no such thing")).toEqual([]);
    expect(
      modifierSections(modifierPickRows(CHOICES, page, null, needs), "All", "").map((s) => s.title),
    ).toEqual([""]);
  });
});

describe("the modifier edits", () => {
  it("adds a feature with its line, for ever unless days are set", () => {
    expect(addModifierOp(7, CHOICES[0], null)).toEqual({
      type: "AddPlanetModifier",
      planet: 7,
      modifier: "mineral_poor",
      days: [-1],
      feature: "pm_mineral_poor",
    });
    expect(addModifierOp(7, CHOICES[3], 360)).toEqual({
      type: "AddPlanetModifier",
      planet: 7,
      modifier: "holy_planet",
      days: [360],
    });
  });

  it("removes a page row: a feature by its line and its modifier, a timed one by its name", () => {
    const page = planetPage({
      id: 7,
      planet_modifiers: ["pm_mineral_poor"],
      timed_modifiers: [
        { modifier: "mineral_poor", days: -1 },
        { modifier: "holy_planet", days: 120 },
      ],
    });
    const views = new Map([["pm_mineral_poor", CHOICES[0].view]]);
    const [feature, timed] = modifierRows(page, views);
    expect(removeModifierOp(7, feature)).toEqual({
      type: "RemovePlanetModifier",
      planet: 7,
      modifier: "mineral_poor",
      feature: "pm_mineral_poor",
    });
    expect(removeModifierOp(7, timed)).toEqual({
      type: "RemovePlanetModifier",
      planet: 7,
      modifier: "holy_planet",
    });
  });

  it("says what was added and reads a days field", () => {
    const rows = modifierPickRows(CHOICES, planetPage(), null, needs);
    expect(addedModifierLine(rows[1], null)).toBe("Added Holy World");
    expect(addedModifierLine(rows[1], 1)).toBe("Added Holy World for 1 day");
    expect([
      parseDays("360"),
      parseDays(" 12 "),
      parseDays("0"),
      parseDays("1.5"),
      parseDays("x"),
    ]).toEqual([360, 12, null, null, null]);
  });
});
