import { describe, expect, it } from "vitest";
import { initializerView, initPlanetView } from "../../test/builders";
import type { DepositView } from "../../generated/DepositView";
import type { InitializerView } from "../../generated/InitializerView";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import { initClassLabel, initializerRows, starClassLabel } from "./initializerRows";

const CLASSES = new Map<string, PlanetClassView>([
  [
    "pc_continental",
    {
      key: "pc_continental",
      icon_sprite: "GFX_planet_type_continental",
      habitable: true,
      star: false,
    },
  ],
  [
    "pc_barren",
    { key: "pc_barren", icon_sprite: "GFX_planet_type_barren", habitable: false, star: false },
  ],
]);

function deposit(key: string, produces: Array<[string, number]>): [string, DepositView] {
  return [
    key,
    { key, icon: null, category: null, produces, is_for_colonizable: true, station: null },
  ];
}

const DEPOSITS = new Map<string, DepositView>([
  deposit("d_minerals_5", [["minerals", 5]]),
  deposit("d_energy_3", [["energy", 3]]),
  deposit("d_society_2", [["society_research", 2]]),
]);

const ICONS = new Map([["minerals", "GFX_resource_minerals_alt"]]);

const VIEW: InitializerView = initializerView({
  name: "sol_system",
  source: "C:/Stellaris/common/solar_system_initializers/sol.txt",
  class: "sc_g",
  usage: "empire_init",
  empire_spawn: true,
  planet_count: 5,
  planets: [
    initPlanetView({ class: "star", size: [20, 30] }),
    initPlanetView({ class: "pc_barren", count: 3, size: [10, 20] }),
    initPlanetView({
      name: "NAME_Earth",
      class: "pc_continental",
      size: [16, 16],
      home_planet: true,
      has_ring: true,
      deposits: ["d_energy_3", "d_minerals_5"],
      moons: [initPlanetView({ name: "NAME_Luna", class: "pc_barren", size: [6, 6] })],
    }),
    initPlanetView({ class: "random_non_colonizable" }),
  ],
});

describe("initializerRows", () => {
  const rows = initializerRows(VIEW, CLASSES, DEPOSITS, ICONS);

  it("leaves out the star and puts each moon after its planet", () => {
    expect(rows.map((r) => [r.planetClass, r.moon])).toEqual([
      ["pc_barren", false],
      ["pc_continental", false],
      ["pc_barren", true],
      ["random_non_colonizable", false],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("shows a rolled size as a range and a fixed one as the number", () => {
    expect(rows.map((r) => r.size)).toEqual(["10–20", "16", "6", null]);
  });

  it("carries the count, the home planet and the ring", () => {
    expect(rows[0].count).toBe(3);
    expect(rows[1]).toMatchObject({
      count: 1,
      homePlanet: true,
      ring: true,
      nameKey: "NAME_Earth",
    });
    expect(rows[0].homePlanet).toBe(false);
  });

  it("sums what the deposits produce, in the game's order, with the icon game data names", () => {
    expect(rows[1].resources).toEqual([
      { resource: "energy", amount: 3, sprite: "sprite:GFX_resource_energy" },
      { resource: "minerals", amount: 5, sprite: "sprite:GFX_resource_minerals_alt" },
    ]);
    expect(rows[0].resources).toEqual([]);
  });

  it("takes the class sprite from game data and labels the classes it has none for", () => {
    expect(rows[1]).toMatchObject({
      sprite: "GFX_planet_type_continental",
      classKey: "pc_continental",
      classLabel: "Continental World",
    });
    expect(rows[3]).toMatchObject({
      sprite: null,
      classKey: null,
      classLabel: "random uninhabitable planet",
    });
  });

  it("ignores a deposit the game data does not know", () => {
    const view = {
      ...VIEW,
      planets: [initPlanetView({ class: "pc_barren", deposits: ["d_nowhere"] })],
    };
    expect(initializerRows(view, CLASSES, DEPOSITS).length).toBe(1);
    expect(initializerRows(view, CLASSES, DEPOSITS)[0].resources).toEqual([]);
  });
});

describe("initClassLabel", () => {
  it("names the random kinds and the random lists", () => {
    expect(initClassLabel("random")).toBe("random planet, any class");
    expect(initClassLabel("")).toBe("random planet, any class");
    expect(initClassLabel("random_asteroid")).toBe("random asteroid");
    expect(initClassLabel("rl_habitable_planets")).toBe("random from habitable planets");
    expect(initClassLabel("none")).toBe("no planet");
    expect(initClassLabel("pc_gas_giant")).toBe("Gas Giant");
  });
});

describe("starClassLabel", () => {
  it("localises a class, unpacks a random list and falls back to the key", () => {
    expect(starClassLabel("sc_g", new Map([["sc_g", "G-Class Star"]]))).toBe("G-Class Star");
    expect(starClassLabel("sc_g")).toBe("sc_g");
    expect(starClassLabel("rl_standard_stars")).toBe("random from standard stars");
    expect(starClassLabel(null)).toBe("random");
  });
});
