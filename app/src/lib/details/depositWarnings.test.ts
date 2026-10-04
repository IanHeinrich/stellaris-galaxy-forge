import { describe, expect, it } from "vitest";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { PlanetPageColony } from "../../generated/PlanetPageColony";
import { depositTypeView, modifierLine } from "../../store/fixtures/planet";
import { planetPage } from "../../test/builders";
import { addWarnings, removalTarget, removalWarnings, warningNameKeys } from "./depositWarnings";

const VIEWS = new Map(
  [
    depositTypeView("d_waterfalls", {
      name: "Rushing Waterfalls",
      effects: [modifierLine("district_generator_max_add", 2, "+2 Max Generator Districts")],
    }),
    depositTypeView("d_hot_springs", {
      name: "Hot Springs",
      effects: [modifierLine("district_generator_max_add", 1, "+1 Max Generator Districts")],
    }),
    depositTypeView("d_mountain_range", {
      name: "Mountain Range",
      blocker: true,
      effects: [modifierLine("planet_max_districts_add", -1, "-1 Max Districts")],
    }),
    depositTypeView("d_crystal_forest", { name: "Crystal Forest" }),
    depositTypeView("d_crystalline_caverns", { name: "Crystalline Caverns" }),
    depositTypeView("d_alien_pets_deposit", { name: "Alien Pets" }),
  ].map((v) => [v.key, v]),
);

const NAMES = new Map([
  ["district_generator", "Generator District"],
  ["building_crystal_mines", "Crystal Mines"],
  ["zone_rare_crystals", "Rare Crystals Zone"],
  ["building_xeno_zoo", "Xeno Zoo"],
  ["energy", "Energy Credits"],
  ["minerals", "Minerals"],
]);

function colony(over: Partial<PlanetPageColony> = {}): PlanetPageColony {
  return {
    id: 7,
    colonised: "2200.01.01",
    final_designation: null,
    designation: null,
    pops: 10,
    species: [],
    districts: [],
    zones: [],
    buildings: [],
    ...over,
  };
}

function colonyPage(kinds: string[], over: Partial<PlanetPage> = {}): PlanetPage {
  return planetPage({
    owner: 0,
    deposits: kinds.map((kind, i) => ({ id: i + 1, kind, swap_type: null })),
    colony: colony(),
    ...over,
  });
}

function removing(page: PlanetPage, id: number): string[] {
  const deposit = page.deposits.find((d) => d.id === id);
  if (deposit === undefined) throw new Error(`no deposit ${id}`);
  return removalWarnings(page, deposit, VIEWS, NAMES);
}

describe("what a deposit edit on a colony costs", () => {
  it("demolishes the districts built over a cap the deposits alone gave", () => {
    const page = colonyPage(["d_waterfalls", "d_hot_springs"], {
      colony: colony({ districts: [{ kind: "district_generator", level: 3 }] }),
    });
    expect(removing(page, 1)).toEqual([
      "The game demolishes 2 Generator Districts within a month.",
    ]);
    expect(removing(page, 2)).toEqual(["The game demolishes 1 Generator District within a month."]);
  });

  it("says may when more is built than the deposits give, so something else adds to the cap", () => {
    const page = colonyPage(["d_waterfalls"], {
      colony: colony({ districts: [{ kind: "district_generator", level: 3 }] }),
    });
    expect(removing(page, 1)).toEqual([
      "The game may demolish 2 Generator Districts within a month.",
    ]);
  });

  it("warns of nothing when what is built fits under the lowered cap, or nothing is built", () => {
    const fits = colonyPage(["d_waterfalls", "d_hot_springs"], {
      colony: colony({ districts: [{ kind: "district_generator", level: 1 }] }),
    });
    expect(removing(fits, 1)).toEqual([]);
    expect(removing(colonyPage(["d_waterfalls"]), 1)).toEqual([]);
    expect(
      removing(planetPage({ deposits: [{ id: 1, kind: "d_waterfalls", swap_type: null }] }), 1),
    ).toEqual([]);
  });

  it("counts the districts that share a cap against it, and names them together", () => {
    const page = colonyPage(["d_waterfalls", "d_hot_springs"], {
      colony: colony({
        districts: [
          { kind: "district_generator", level: 1 },
          { kind: "district_geothermal", level: 2 },
        ],
      }),
    });
    expect(removing(page, 1)).toEqual(["The game demolishes 2 districts within a month."]);
    const geothermal = colonyPage(["d_waterfalls", "d_hot_springs"], {
      colony: colony({ districts: [{ kind: "district_geothermal", level: 3 }] }),
    });
    expect(removing(geothermal, 2)).toEqual([
      "The game demolishes 1 Geothermal District within a month.",
    ]);
  });

  it("warns of no generator districts on a planet where they have no cap", () => {
    for (const planetClass of ["pc_volcanic", "pc_shattered_ring_habitable"]) {
      const page = colonyPage(["d_waterfalls"], {
        class: planetClass,
        colony: colony({ districts: [{ kind: "district_generator", level: 3 }] }),
      });
      expect(removing(page, 1)).toEqual([]);
    }
  });

  it("says a blocker added to a colony with districts may demolish one, and one that adds capacity nothing", () => {
    const page = colonyPage([], {
      colony: colony({ districts: [{ kind: "district_city", level: 4 }] }),
    });
    expect(addWarnings(page, "d_mountain_range", VIEWS, NAMES)).toEqual([
      "The game may demolish 1 district within a month.",
    ]);
    expect(addWarnings(page, "d_waterfalls", VIEWS, NAMES)).toEqual([]);
    expect(addWarnings(colonyPage([]), "d_mountain_range", VIEWS, NAMES)).toEqual([]);
    expect(removing(colonyPage(["d_mountain_range"], { colony: page.colony }), 1)).toEqual([]);
  });

  it("names the zone and building that need a deposit the colony would have none of left", () => {
    const built = colony({
      zones: ["zone_default", "zone_rare_crystals"],
      buildings: ["building_crystal_mines"],
    });
    const one = colonyPage(["d_crystal_forest"], { colony: built });
    expect(removing(one, 1)).toEqual([
      "Rare Crystals Zone needs Crystal Forest. The game removes it within a month.",
      "Crystal Mines needs Crystal Forest. The game removes it within a month.",
    ]);
    const two = colonyPage(["d_crystal_forest", "d_crystalline_caverns"], { colony: built });
    expect(removing(two, 1)).toEqual([]);
    const zoo = colonyPage(["d_alien_pets_deposit"], {
      colony: colony({ buildings: ["building_xeno_zoo"] }),
    });
    expect(removing(zoo, 1)).toEqual([
      "Xeno Zoo needs Alien Pets. The game removes it within a month.",
    ]);
    expect(removing(colonyPage(["d_alien_pets_deposit"]), 1)).toEqual([]);
    // A habitat's rare crystals come from its system's mining stations, not its own deposits.
    const habitat = colonyPage(["d_crystal_forest"], { class: "pc_habitat", colony: built });
    expect(removing(habitat, 1)).toEqual([]);
  });

  it("says a blocker being cleared loses what was spent, and a blocker nobody clears nothing", () => {
    const page = colonyPage(["d_mountain_range", "d_mountain_range"], {
      clearing: [
        {
          deposit: 2,
          cost: [
            ["energy", 750],
            ["minerals", 250],
          ],
        },
      ],
    });
    expect(removing(page, 2)).toEqual([
      "Mountain Range is being cleared. Removing it cancels the clearing, and the 750 Energy Credits and 250 Minerals already spent isn't refunded.",
    ]);
    expect(removing(page, 1)).toEqual([]);
  });

  it("removes a blocker nobody is clearing before the one being cleared", () => {
    const page = colonyPage(["d_mountain_range", "d_mountain_range"], {
      clearing: [{ deposit: 2, cost: [["energy", 300]] }],
    });
    expect(removalTarget(page, "d_mountain_range", null)?.id).toBe(1);
    const cleared = { ...page, deposits: page.deposits.slice(1) };
    expect(removalTarget(cleared, "d_mountain_range", null)?.id).toBe(2);
  });

  it("asks for the names of the districts, zones, buildings and resources it may use", () => {
    const page = colonyPage([], {
      colony: colony({
        districts: [{ kind: "district_mining", level: 1 }],
        zones: ["zone_industrial"],
        buildings: ["building_factory_1"],
      }),
      clearing: [{ deposit: 1, cost: [["energy", 300]] }],
    });
    expect(warningNameKeys(page)).toEqual([
      "district_mining",
      "zone_industrial",
      "building_factory_1",
      "energy",
    ]);
  });
});
