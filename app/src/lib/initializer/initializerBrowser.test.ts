import { describe, expect, it } from "vitest";
import { initializerView, initPlanetView } from "../../test/builders";
import type { DepositView } from "../../generated/DepositView";
import type { InitializerView } from "../../generated/InitializerView";
import type { ModRef } from "./initializerGroups";
import {
  browserGroups,
  initializerTotals,
  newSystemRows,
  notedRecent,
  pinToggle,
  type BrowserGroup,
} from "./initializerBrowser";

const INSTALL = "C:/Stellaris";
const VANILLA = `${INSTALL}/common/solar_system_initializers`;
const MOD_A = "C:/Users/someone/Documents/Paradox Interactive/Stellaris/mod/more_stars";

const MODS: ModRef[] = [{ name: "More Stars", path: MOD_A }];

const entry = (
  name: string,
  source: string,
  rest: Partial<InitializerView> = {},
): InitializerView => initializerView({ name, source, ...rest });

const SOL = entry("sol_system", `${VANILLA}/sol_initializers.txt`, {
  usage: "misc_system_init",
  planet_count: 3,
  planets: [
    initPlanetView({ class: "star", deposits: ["d_energy_3"] }),
    initPlanetView({
      class: "pc_continental",
      deposits: ["d_minerals_5", "d_energy_3"],
      moons: [
        initPlanetView({ class: "pc_barren", deposits: ["d_society_2", "d_nowhere", "d_odd"] }),
      ],
    }),
  ],
});

const LIST: InitializerView[] = [
  SOL,
  entry("empire_init_01", `${VANILLA}/empire_initializers.txt`, {
    usage: "empire_init",
    empire_spawn: true,
  }),
  entry("misc_init_03", `${VANILLA}/misc_system_initializers.txt`, { usage: "misc_system_init" }),
  entry("hostile_init_01", `${VANILLA}/hostile_system_initializers.txt`, {
    usage: "misc_system_init",
  }),
  entry("marauder_init_01", `${VANILLA}/marauder_initializers.txt`, { usage: "nomad_init" }),
  entry("dyson_sphere_init_01", `${VANILLA}/misc_system_initializers.txt`, {
    usage: "misc_system_init",
  }),
  entry("more_stars_init", `${MOD_A}/common/solar_system_initializers/stars.txt`, {
    usage: "misc_system_init",
  }),
];

const COUNTS = new Map([
  ["sol_system", 3],
  ["more_stars_init", 1],
  ["not_in_the_game_data", 7],
]);

const GAME_DATA_GROUPS = [
  "Empire spawn",
  "Marauder",
  "Hostile",
  "Megastructures",
  "More Stars",
  "Misc",
  "Sol",
];

const names = (group: BrowserGroup | undefined) => group?.entries.map((e) => e.entry.name) ?? [];

describe("browserGroups", () => {
  const groups = browserGroups(
    LIST,
    MODS,
    ["hostile_init_01", "long_gone_init", "sol_system"],
    ["more_stars_init", "also_gone"],
    COUNTS,
  );

  it("offers the pinned and recent picks before the game data's own groups", () => {
    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Recent", ...GAME_DATA_GROUPS]);
    expect(groups.map((g) => g.id).slice(0, 2)).toEqual(["pinned", "recent"]);
  });

  it("keeps the order the pins were given and drops keys the game data has not got", () => {
    expect(names(groups[0])).toEqual(["hostile_init_01", "sol_system"]);
    expect(names(groups[1])).toEqual(["more_stars_init"]);
  });

  it("leaves the game data's groups as they are", () => {
    expect(names(groups.find((g) => g.label === "Megastructures"))).toEqual([
      "dyson_sphere_init_01",
    ]);
    expect(names(groups.find((g) => g.label === "More Stars"))).toEqual(["more_stars_init"]);
  });

  it("counts the systems in the document that already use each entry", () => {
    expect(groups.find((g) => g.label === "Sol")?.entries).toEqual([{ entry: SOL, uses: 3 }]);
    expect(groups.find((g) => g.label === "Marauder")?.entries[0].uses).toBe(0);
  });

  it("leaves out a synthetic group with nothing to show", () => {
    expect(browserGroups(LIST, MODS, [], [], COUNTS).map((g) => g.label)).toEqual(GAME_DATA_GROUPS);
    expect(browserGroups(LIST, MODS, ["long_gone_init"], [], COUNTS)[0].label).toBe("Empire spawn");
  });
});

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
  deposit("d_odd", [["sr_unheard_of", 1]]),
]);

describe("initializerTotals", () => {
  it("sums every body and moon in the game's display order", () => {
    expect(initializerTotals(SOL, DEPOSITS)).toEqual([
      ["energy", 6],
      ["minerals", 5],
      ["society_research", 2],
      ["sr_unheard_of", 1],
    ]);
  });

  it("is empty when nothing the initializer spawns produces anything", () => {
    expect(initializerTotals(LIST[1], DEPOSITS)).toEqual([]);
    expect(
      initializerTotals(
        entry("bare", `${VANILLA}/a.txt`, { planets: [initPlanetView({ class: "pc_barren" })] }),
        DEPOSITS,
      ),
    ).toEqual([]);
  });
});

describe("pinToggle", () => {
  it("pins an initializer last and unpins one that is already there", () => {
    expect(pinToggle([], "a")).toEqual(["a"]);
    expect(pinToggle(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(pinToggle(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("notedRecent", () => {
  it("puts the pick first, without repeating it", () => {
    expect(notedRecent([], "a")).toEqual(["a"]);
    expect(notedRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(notedRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("keeps at most the cap it is given", () => {
    expect(notedRecent(["b", "c", "d"], "a", 3)).toEqual(["a", "b", "c"]);
    expect(notedRecent(["a", "b"], "c", 0)).toEqual([]);
    const ten = Array.from({ length: 12 }, (_, i) => `k${i}`);
    expect(notedRecent(ten, "new")).toHaveLength(10);
  });
});

describe("newSystemRows", () => {
  it("offers the default alone, naming random when there is none", () => {
    expect(newSystemRows(null, null)).toEqual([
      { label: "New system", key: null, detail: "random" },
    ]);
    expect(newSystemRows("sol_system", null)).toEqual([
      { label: "New system", key: "sol_system", detail: "sol_system" },
    ]);
  });

  it("adds the last used only where it differs from the default", () => {
    expect(newSystemRows("sol_system", "sol_system")).toHaveLength(1);
    expect(newSystemRows("sol_system", "empire_init_01")).toEqual([
      { label: "New system", key: "sol_system", detail: "sol_system" },
      { label: "New system, last used", key: "empire_init_01", detail: "empire_init_01" },
    ]);
    expect(newSystemRows(null, "empire_init_01")[1]).toEqual({
      label: "New system, last used",
      key: "empire_init_01",
      detail: "empire_init_01",
    });
  });
});
