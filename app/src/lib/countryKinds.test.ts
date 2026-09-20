import { describe, expect, it } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { CountryTypeView } from "../generated/CountryTypeView";
import { drawsBorders, isFauna, territoryKind } from "./countryKinds";
import { COUNTRY } from "./details/fixture";

describe("countryKinds", () => {
  const type = (over: Partial<CountryTypeView>): CountryTypeView => ({
    name: "x",
    is_space_critter: false,
    space_creatures: false,
    generate_borders: true,
    is_enclave: false,
    fallen_empire: false,
    playable: false,
    leviathan: false,
    ...over,
  });
  const of = (country_type: string): CountryNode => ({ ...COUNTRY, country_type });

  it("reads the game's flags when loaded and falls back to the vanilla type names", () => {
    const types = new Map<string, CountryTypeView>([
      ["mod_beast", type({ is_space_critter: true, generate_borders: false })],
      ["mod_empire", type({})],
      ["mod_station", type({ generate_borders: false })],
    ]);
    expect(isFauna(of("mod_beast"), types)).toBe(true);
    expect(isFauna(of("mod_empire"), types)).toBe(false);
    expect(drawsBorders(of("mod_empire"), types)).toBe(true);
    expect(drawsBorders(of("mod_station"), types)).toBe(false);
    expect(drawsBorders(of("mod_beast"), types)).toBe(false);
    expect(isFauna(undefined, types)).toBe(true);

    const none = new Map<string, CountryTypeView>();
    expect(isFauna(of("guardian_dragon"), none)).toBe(true);
    expect(isFauna(of("fallen_empire"), none)).toBe(false);
    expect(drawsBorders(of("dormant_marauders"), none)).toBe(true);
    expect(drawsBorders(of("enclave"), none)).toBe(false);
    expect(drawsBorders(of("caravaneer_home"), none)).toBe(true);
    expect(drawsBorders(of("caravaneer_fleet"), none)).toBe(false);
    expect(drawsBorders(of("tiyanki"), none)).toBe(false);
    expect(drawsBorders(of("default"), none)).toBe(true);
    expect(territoryKind(of("dormant_marauders"), none)).toBe("marauder");
    expect(territoryKind(of("awakened_fallen_empire"), none)).toBe("fallen_empire");
    expect(
      territoryKind(of("mod_old_ones"), new Map([["mod_old_ones", type({ fallen_empire: true })]])),
    ).toBe("fallen_empire");
    expect(territoryKind(of("default"), none)).toBeNull();
  });
});
