import { describe, expect, it } from "vitest";
import type { FleetSummary } from "../../generated/FleetSummary";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { ShipSizeView } from "../../generated/ShipSizeView";
import { fleetSummary, planetSummary } from "../../test/builders";
import { fleetIcon, formatPops, orderedPlanets } from "./rows";

const planet = (p: Partial<PlanetSummary> & { id: number }): PlanetSummary =>
  planetSummary({ class: "pc_barren", habitable: false, ...p });

const fleet = (sizes: Array<[string, number]>): FleetSummary =>
  fleetSummary({ ships: 0, ship_sizes: sizes.map(([key, count]) => ({ key, count })) });

const SHIP_SIZES = new Map<string, ShipSizeView>([
  ["corvette", { key: "corvette", icon: "ship_size_military_1" }],
  ["cruiser", { key: "cruiser", icon: "ship_size_military_8" }],
  ["battleship", { key: "battleship", icon: "ship_size_military_16" }],
  ["constructor", { key: "constructor", icon: "ship_size_constructor" }],
  ["unknown_hull", { key: "unknown_hull", icon: null }],
]);

describe("formatPops", () => {
  it("writes pop counts as the game does", () => {
    expect(formatPops(0)).toBe("0");
    expect(formatPops(834)).toBe("834");
    expect(formatPops(5432)).toBe("5.4K");
    expect(formatPops(1_250_000)).toBe("1.3M");
  });
});

describe("orderedPlanets", () => {
  const isStar = (p: PlanetSummary) => p.class === "star" || p.class.endsWith("_star");

  it("puts the capital first, then colonies, then free habitable worlds, each with its moons", () => {
    const planets = [
      planet({ id: 1, class: "pc_gas_giant" }),
      planet({ id: 2, class: "pc_barren", moon: true }),
      planet({ id: 3, class: "pc_continental", habitable: true }),
      planet({ id: 4, class: "pc_arid", colonised: true, capital: true }),
      planet({ id: 5, class: "pc_barren", moon: true }),
      planet({ id: 6, class: "pc_desert", colonised: true }),
    ];
    expect(orderedPlanets(planets, isStar).map((p) => p.id)).toEqual([4, 5, 6, 3, 1, 2]);
  });

  it("puts the star before the capital, wherever the file writes it", () => {
    const save = [
      planet({ id: 1, class: "pc_arid", colonised: true, capital: true }),
      planet({ id: 2, class: "pc_barren", moon: true }),
      planet({ id: 3, class: "pc_g_star" }),
    ];
    expect(orderedPlanets(save, isStar).map((p) => p.id)).toEqual([3, 1, 2]);

    const scenario = [
      planet({ id: 1, class: "pc_continental", habitable: true }),
      planet({ id: 2, class: "star" }),
    ];
    expect(orderedPlanets(scenario, isStar).map((p) => p.id)).toEqual([2, 1]);
  });
});

describe("fleetIcon", () => {
  it("takes the highest military rank present, else the first size's icon", () => {
    expect(
      fleetIcon(
        fleet([
          ["corvette", 4],
          ["battleship", 1],
          ["cruiser", 2],
        ]),
        SHIP_SIZES,
      ),
    ).toBe("ship_size_military_16");
    expect(fleetIcon(fleet([["constructor", 1]]), SHIP_SIZES)).toBe("ship_size_constructor");
    expect(fleetIcon(fleet([["unknown_hull", 1]]), SHIP_SIZES)).toBeNull();
    expect(fleetIcon(fleet([]), SHIP_SIZES)).toBeNull();
  });
});
