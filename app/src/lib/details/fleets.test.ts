import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import { COUNTRY, details, fleet } from "./fixture";
import {
  empireFlagKey,
  fleetGroups,
  fleetPower,
  fleetPowerClause,
  fleetSides,
  formatPower,
} from "./fleets";

describe("formatPower", () => {
  it.each([
    [0, "0"],
    [8019.4, "8,019"],
    [999_999, "999,999"],
    [1_012_345, "1.01m"],
    [12_400_000, "12.40m"],
  ])("separates thousands below a million and abbreviates above it: %s", (n, text) => {
    expect(formatPower(n)).toBe(text);
  });
});

describe("fleetGroups", () => {
  it("groups military fleets by owner in order of appearance, neutral ones last", () => {
    const d = details({
      fleets_present: [
        fleet({ id: 1, owner: null, military_power: 500 }),
        fleet({ id: 2, owner: 7, military_power: 8000 }),
        fleet({ id: 3, owner: 3, military_power: 100 }),
        fleet({ id: 4, owner: 7, military_power: 4340 }),
        fleet({ id: 5, owner: 7, military: false, military_power: 0 }),
      ],
    });
    const groups = fleetGroups(d, (id) => `Country ${id}`);
    expect(groups.map((g) => [g.name, g.power, g.fleets.map((f) => f.id)])).toEqual([
      ["Country 7", 12340, [2, 4]],
      ["Country 3", 100, [3]],
      ["Neutral fleets", 500, [1]],
    ]);
  });

  it("is empty without military fleets", () => {
    expect(fleetGroups(details({}), () => "")).toEqual([]);
  });

  it("splits the groups into empire and fauna sides, ownerless fleets counting as fauna", () => {
    const countries = new Map<number, CountryNode>([
      [7, { ...COUNTRY, id: 7, country_type: "default" }],
      [3, { ...COUNTRY, id: 3, country_type: "tiyanki" }],
    ]);
    const d = details({
      fleets_present: [
        fleet({ id: 1, owner: null }),
        fleet({ id: 2, owner: 7 }),
        fleet({ id: 3, owner: 3 }),
      ],
    });
    const { empire, fauna } = fleetSides(fleetGroups(d, String), countries, new Map());
    expect(empire.map((g) => g.owner)).toEqual([7]);
    expect(fauna.map((g) => g.owner)).toEqual([3, null]);
  });
});

describe("fleetPower", () => {
  it("shows a skull for a planet killer, disabled for a knocked-out fleet, else the power", () => {
    const base = fleet();
    expect(fleetPower({ ...base, planet_killer: true })).toBe("☠");
    expect(fleetPower({ ...base, disabled_ships: 1 })).toBe("disabled");
    expect(fleetPower({ ...base, military_power: 8019 })).toBe("8,019");
    expect(fleetPower(base)).toBe("0");
  });

  it("gives the row a clause where the states stand alone and a number is labelled", () => {
    const base = fleet();
    expect(fleetPowerClause({ ...base, planet_killer: true })).toBe("☠");
    expect(fleetPowerClause({ ...base, disabled_ships: 1 })).toBe("disabled");
    expect(fleetPowerClause({ ...base, military_power: 8019 })).toBe("power 8,019");
  });
});

describe("empireFlagKey", () => {
  it("pads the colours to four", () => {
    expect(empireFlagKey(COUNTRY)).toBe(
      "empire_flag:00_solid.dds:human/flag_human_9.dds:blue,black,null,null",
    );
  });

  it("is null without an icon or a country", () => {
    expect(empireFlagKey({ ...COUNTRY, flag_icon: null })).toBeNull();
    expect(empireFlagKey(undefined)).toBeNull();
  });
});
