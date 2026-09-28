import { describe, expect, it } from "vitest";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import { planetPage } from "../../test/builders";
import {
  addModifierOp,
  effectText,
  removeDepositOp,
  removeModifierOp,
  renamePlanetOp,
  uncolonised,
} from "./planetEdits";
import { modifierRows } from "./planetPage";

function choice(modifier: string, name: string, feature: string | null = null): ModifierChoice {
  return {
    modifier,
    feature,
    category: feature === null ? "Positive" : "Feature",
    description: null,
    view: {
      key: feature ?? modifier,
      name,
      static_modifier: modifier,
      icon: null,
      icon_frame: null,
      effects: [],
    },
  };
}

const MINERAL_POOR = choice("mineral_poor", "Mineral Poor", "pm_mineral_poor");
const HOLY_WORLD = choice("holy_planet", "Holy World");

describe("a planet page's edits", () => {
  it("renames to the trimmed text, and not to nothing or the same name", () => {
    expect(renamePlanetOp(5, "Olbers II", "  Nova Terra ")).toEqual({
      type: "RenameSavePlanet",
      planet: 5,
      name: "Nova Terra",
    });
    expect(renamePlanetOp(5, "Olbers II", "   ")).toBeNull();
    expect(renamePlanetOp(5, "Olbers II", "Olbers II")).toBeNull();
  });

  it("removes the last deposit of a row's type and swap", () => {
    const page = planetPage({
      deposits: [
        { id: 1, kind: "d_minerals_2", swap_type: null },
        { id: 2, kind: "d_massive_glacier", swap_type: "d_crystalline_caverns" },
        { id: 3, kind: "d_minerals_2", swap_type: null },
      ],
    });
    expect(removeDepositOp(page, "d_minerals_2", null)).toEqual({
      type: "RemoveSaveDeposit",
      deposit: 3,
    });
    expect(removeDepositOp(page, "d_massive_glacier", null)).toBeNull();
  });

  it("words a lost district as what a blocker blocks, and any other effect as the game does", () => {
    const line = (key: string, value: number, text: string) => ({ key, value, text });
    expect(effectText(line("planet_max_districts_add", -1, "-1 Max Districts"))).toBe(
      "Blocks 1 district",
    );
    expect(effectText(line("planet_max_districts_add", -2, "-2 Max Districts"))).toBe(
      "Blocks 2 districts",
    );
    expect(effectText(line("district_mining_max_add", 2, "+2 Max Mining Districts"))).toBe(
      "+2 Max Mining Districts",
    );
  });

  it("counts a planet as uncolonised only with no owner and no colony", () => {
    expect(uncolonised(planetPage())).toBe(true);
    expect(uncolonised(planetPage({ owner: 3 }))).toBe(false);
  });
});

describe("the modifier edits", () => {
  it("adds a feature with its line, for ever unless days are set", () => {
    expect(addModifierOp(7, MINERAL_POOR, null)).toEqual({
      type: "AddPlanetModifier",
      planet: 7,
      modifier: "mineral_poor",
      days: [-1],
      feature: "pm_mineral_poor",
    });
    expect(addModifierOp(7, HOLY_WORLD, 360)).toEqual({
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
    const views = new Map([["pm_mineral_poor", MINERAL_POOR.view]]);
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
});
