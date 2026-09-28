import { describe, expect, it } from "vitest";
import { depositTypeView } from "../../store/fixture";
import { planetPage } from "../../test/builders";
import { depositChoices, removeDepositOp, renamePlanetOp, uncolonised } from "./planetEdits";

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

  it("offers features by name before blockers", () => {
    const views = new Map(
      [
        depositTypeView("d_b", { name: "Bog" }),
        depositTypeView("d_glacier", { name: "Glacier", blocker: true }),
        depositTypeView("d_a", { name: "Ash" }),
      ].map((v) => [v.key, v]),
    );
    const keys = depositChoices(["d_glacier", "d_b", "d_unknown", "d_a"], views).map((c) => c.key);
    expect(keys).toEqual(["d_a", "d_b", "d_unknown", "d_glacier"]);
  });

  it("counts a planet as uncolonised only with no owner and no colony", () => {
    expect(uncolonised(planetPage())).toBe(true);
    expect(uncolonised(planetPage({ owner: 3 }))).toBe(false);
  });
});
