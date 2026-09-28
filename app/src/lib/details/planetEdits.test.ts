import { describe, expect, it } from "vitest";
import { planetPage } from "../../test/builders";
import {
  effectText,
  removeDepositOp,
  renamePlanetOp,
  uncolonised,
} from "./planetEdits";

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
