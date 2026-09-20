import { describe, expect, it } from "vitest";
import { initializerView } from "../../test/builders";
import type { InitializerView } from "../../generated/InitializerView";
import type { ModRef } from "./initializerGroups";
import { buildIndex, search } from "./initializerSearch";

const INSTALL = "C:/Stellaris";
const VANILLA = `${INSTALL}/common/solar_system_initializers`;
const MOD_A = "C:/Users/someone/Documents/Paradox Interactive/Stellaris/mod/more_stars";

const MODS: ModRef[] = [{ name: "More Stars", path: MOD_A }];

const entry = (
  name: string,
  source: string,
  rest: Partial<InitializerView> = {},
): InitializerView => initializerView({ name, source, ...rest });

/** The star body an initializer names its system after. */
function star(name: string | null) {
  return {
    name,
    class: "star",
    size: null,
    orbit_distance: null,
    has_ring: false,
    count: 1,
    home_planet: false,
    deposits: [],
    moons: [],
  };
}

const LIST: InitializerView[] = [
  entry("sol_system", `${VANILLA}/sol_initializers.txt`, {
    class: "sc_g",
    usage: "misc_system_init",
    planets: [star("NAME_Sol")],
    planet_count: 8,
  }),
  entry("empire_init_01", `${VANILLA}/empire_initializers.txt`, {
    class: "sc_g",
    usage: "empire_init",
    empire_spawn: true,
    countries: [{ name_key: "SPAWNED_EMPIRE_NAME", country_type: "default", icon: null }],
    planet_count: 5,
  }),
  entry("binary_sol_alt", `${VANILLA}/misc_system_initializers.txt`, {
    class: "sc_binary_1",
    usage: "misc_system_init",
    planet_count: 4,
  }),
  entry("misc_init_03", `${VANILLA}/misc_system_initializers.txt`, {
    usage: "misc_system_init",
    planets: [star("NAME_Solaria")],
    planet_count: 4,
  }),
  entry("fallen_empire_init_01", `${VANILLA}/fallen_empire_initializers.txt`, {
    class: "sc_a",
    usage: "fallen_empire_init",
    flags: ["fallen_empire_system"],
    planet_count: 12,
  }),
  entry("marauder_init_01", `${VANILLA}/marauder_initializers.txt`, {
    usage: "nomad_init",
    planet_count: 0,
  }),
  entry("hostile_init_01", `${VANILLA}/hostile_system_initializers.txt`, {
    usage: "misc_system_init",
    flags: ["hostile_wraith"],
    planet_count: 3,
  }),
  entry("more_stars_init", `${MOD_A}/common/solar_system_initializers/stars.txt`, {
    class: "sc_b",
    usage: "misc_system_init",
    planet_count: 2,
  }),
];

const NAMES = new Map([
  ["sc_g", "G-type star"],
  ["sc_a", "A-type star"],
  ["NAME_Sol", "Sol"],
  ["NAME_Solaria", "Solaria"],
]);

const INDEX = buildIndex(LIST, MODS, NAMES);
const hits = (query: string) => search(INDEX, query).map((e) => e.name);

describe("search", () => {
  it("returns every entry in input order for an empty query", () => {
    expect(hits("")).toEqual(LIST.map((e) => e.name));
    expect(hits("   ")).toEqual(LIST.map((e) => e.name));
  });

  it("ranks a key the query opens, then a key it appears inside, then any other field", () => {
    expect(hits("sol")).toEqual(["sol_system", "binary_sol_alt", "misc_init_03"]);
  });

  it("keeps input order within a rank", () => {
    expect(hits("init_01")).toEqual([
      "empire_init_01",
      "fallen_empire_init_01",
      "marauder_init_01",
      "hostile_init_01",
    ]);
  });

  it("requires every token to match", () => {
    expect(hits("init empire")).toEqual(["empire_init_01", "fallen_empire_init_01"]);
    expect(hits("init empire nothing")).toEqual([]);
  });

  it("matches the localised star class as well as the raw one", () => {
    expect(hits("class:g-type")).toEqual(["sol_system", "empire_init_01"]);
    expect(hits("class:sc_a")).toEqual(["fallen_empire_init_01"]);
  });

  it("matches a usage, a mod or file label and a flag by prefix", () => {
    expect(hits("usage:nomad")).toEqual(["marauder_init_01"]);
    expect(hits("mod:more")).toEqual(["more_stars_init"]);
    expect(hits("mod:hostile_system")).toEqual(["hostile_init_01"]);
    expect(hits("flag:hostile")).toEqual(["hostile_init_01"]);
  });

  it("matches the name keys of the countries it spawns", () => {
    expect(hits("spawned_empire")).toEqual(["empire_init_01"]);
  });

  it("compares the body count with planets:", () => {
    expect(hits("planets:>4")).toEqual(["sol_system", "empire_init_01", "fallen_empire_init_01"]);
    expect(hits("planets:<3")).toEqual(["marauder_init_01", "more_stars_init"]);
    expect(hits("planets:4")).toEqual(["binary_sol_alt", "misc_init_03"]);
  });

  it("combines a field term with a word", () => {
    expect(hits("usage:misc_system_init sol")).toEqual([
      "sol_system",
      "binary_sol_alt",
      "misc_init_03",
    ]);
  });

  it("treats an unknown prefix as plain text", () => {
    expect(hits("name:sol")).toEqual([]);
  });

  it("stops at the limit it is given", () => {
    expect(search(INDEX, "", 2).map((e) => e.name)).toEqual(["sol_system", "empire_init_01"]);
    expect(search(INDEX, "sol", 1).map((e) => e.name)).toEqual(["sol_system"]);
  });
});
