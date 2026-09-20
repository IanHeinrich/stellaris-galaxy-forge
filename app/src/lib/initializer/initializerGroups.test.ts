import { describe, expect, it } from "vitest";
import { initializerView } from "../../test/builders";
import type { InitializerView } from "../../generated/InitializerView";
import { groupInitializers, relativeSource, type ModRef } from "./initializerGroups";

const INSTALL = "C:/Stellaris";
const VANILLA = `${INSTALL}/common/solar_system_initializers`;
const MOD_A = "C:/Users/someone/Documents/Paradox Interactive/Stellaris/mod/more_stars";
const MOD_B = "D:/SteamLibrary/steamapps/workshop/content/281990/3575236236";

const MODS: ModRef[] = [
  { name: "More Stars", path: MOD_A },
  { name: "New Dawn", path: MOD_B },
];

const entry = (
  name: string,
  source: string,
  usage: string | null = null,
  empireSpawn = false,
): InitializerView => initializerView({ name, source, usage, empire_spawn: empireSpawn });

const LIST: InitializerView[] = [
  entry("sol_system", `${VANILLA}/sol_initializers.txt`, "misc_system_init"),
  entry("empire_init_01", `${VANILLA}/empire_initializers.txt`, "empire_init", true),
  entry("custom_empire_init", `${VANILLA}/custom_starting_initializers.txt`, "custom_empire", true),
  entry("fallen_empire_init_01", `${VANILLA}/fallen_empire_initializers.txt`, "fallen_empire_init"),
  entry("marauder_init_01", `${VANILLA}/marauder_initializers.txt`, "nomad_init"),
  entry("origin_shattered_ring", `${VANILLA}/federations_origin_initializers.txt`, "origin"),
  entry("guardian_dragon", `${VANILLA}/leviathans_system_initializers.txt`, "misc_system_init"),
  entry("hostile_init_01", `${VANILLA}/hostile_system_initializers.txt`, "misc_system_init"),
  entry("dyson_sphere_init_01", `${VANILLA}/misc_system_initializers.txt`, "misc_system_init"),
  entry("unique_init_zanaam", `${VANILLA}/unique_system_initializers.txt`, "misc_system_init"),
  entry("misc_init_03", `${VANILLA}/misc_system_initializers.txt`, "misc_system_init"),
  entry(
    "more_stars_init",
    `${MOD_A}/common/solar_system_initializers/stars.txt`,
    "misc_system_init",
  ),
  entry("nd_coruscant", `${MOD_B}/common/solar_system_initializers/core.txt`, "misc_system_init"),
  entry(
    "nd_empire_start",
    `${MOD_B}/common/solar_system_initializers/starts.txt`,
    "empire_init",
    true,
  ),
];

describe("groupInitializers", () => {
  const groups = groupInitializers(LIST, MODS);
  const names = (label: string) =>
    groups.find((g) => g.label === label)?.entries.map((e) => e.name) ?? [];

  it("orders the derived categories, then the mods, then the remaining vanilla files", () => {
    expect(groups.map((g) => g.label)).toEqual([
      "Empire spawn",
      "Fallen empire",
      "Marauder",
      "Origin",
      "Leviathans",
      "Hostile",
      "Megastructures",
      "Unique & special",
      "More Stars",
      "New Dawn",
      "Misc",
      "Sol",
    ]);
  });

  it("puts each initializer in the first category that claims it, mods included", () => {
    expect(names("Empire spawn")).toEqual([
      "custom_empire_init",
      "empire_init_01",
      "nd_empire_start",
    ]);
    expect(names("Fallen empire")).toEqual(["fallen_empire_init_01"]);
    expect(names("Marauder")).toEqual(["marauder_init_01"]);
    expect(names("Origin")).toEqual(["origin_shattered_ring"]);
    expect(names("Leviathans")).toEqual(["guardian_dragon"]);
    expect(names("Hostile")).toEqual(["hostile_init_01"]);
    expect(names("Megastructures")).toEqual(["dyson_sphere_init_01"]);
    expect(names("Unique & special")).toEqual(["unique_init_zanaam"]);
    expect(names("More Stars")).toEqual(["more_stars_init"]);
    expect(names("New Dawn")).toEqual(["nd_coruscant"]);
    expect(names("Misc")).toEqual(["misc_init_03"]);
    expect(names("Sol")).toEqual(["sol_system"]);
  });

  it("names a mod group by its folder when the mod has no name", () => {
    const [group] = groupInitializers(
      [entry("nd_coruscant", `${MOD_B}/common/solar_system_initializers/core.txt`)],
      [{ name: "  ", path: MOD_B }],
    );
    expect(group.label).toBe("3575236236");
  });

  it("leaves out a group nothing falls into", () => {
    expect(groupInitializers([], MODS)).toEqual([]);
  });
});

describe("relativeSource", () => {
  it("shows the file under the mod or install that holds it", () => {
    expect(relativeSource(`${VANILLA}\\sol_initializers.txt`, [INSTALL, MOD_A])).toBe(
      "common/solar_system_initializers/sol_initializers.txt",
    );
    expect(relativeSource(`${MOD_A}/common/stars.txt`, [INSTALL, MOD_A])).toBe("common/stars.txt");
    expect(relativeSource("E:/elsewhere/a.txt", [INSTALL])).toBe("E:/elsewhere/a.txt");
  });
});
