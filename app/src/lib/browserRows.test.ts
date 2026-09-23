import { describe, expect, it } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { CountryRef } from "../generated/CountryRef";
import type { CountryTypeView } from "../generated/CountryTypeView";
import type { Issue } from "../generated/Issue";
import type { NameTemplate } from "../generated/NameTemplate";
import type { SpecialSystem } from "../generated/SpecialSystem";
import { systemNode } from "../test/builders";
import { composeOwnership } from "./ownership";
import {
  empireGroups,
  issueGroups,
  pointGroups,
  specialSystemOfCountry,
  type RowLookups,
} from "./browserRows";

function name(key: string): NameTemplate {
  return { key, literal: false, variables: [] };
}

const SYSTEM_NAMES = new Map([
  [0, "Sol"],
  [1, "Alpha Centauri"],
  [2, "Barnard"],
  [3, "Sirius"],
]);

const LOOKUPS: RowLookups = {
  countryName: (country) => country.name_key,
  systemName: (id) => SYSTEM_NAMES.get(id) ?? `#${id}`,
  centralSystem: (ownerId) => (ownerId === 2 ? 3 : null),
};

function countryType(name: string, extra: Partial<CountryTypeView> = {}): CountryTypeView {
  return {
    name,
    is_space_critter: false,
    space_creatures: false,
    generate_borders: true,
    is_enclave: false,
    fallen_empire: false,
    playable: true,
    leviathan: false,
    ...extra,
  };
}

const TYPES = new Map(
  [
    countryType("default"),
    countryType("fallen_empire", { fallen_empire: true, playable: false }),
    countryType("awakened_fallen_empire", { fallen_empire: true, playable: false }),
    countryType("enclave_trader", { is_enclave: true, generate_borders: false, playable: false }),
    countryType("amoeba", { is_space_critter: true, generate_borders: false, playable: false }),
    countryType("caravaneer_home", { generate_borders: false, playable: false }),
  ].map((t) => [t.name, t]),
);

function country(id: number, key: string, type: string, extra: Partial<CountryNode> = {}) {
  return {
    id,
    name: name(key),
    name_key: key,
    country_type: type,
    capital_system: 0,
    system_count: 1,
    colors: [],
    border_color: null,
    fill_color: null,
    flag_icon: null,
    flag_background: null,
    ...extra,
  };
}

const COUNTRIES = new Map(
  [
    country(0, "Humans", "default", { system_count: 3, capital_system: 0 }),
    country(1, "Blorg", "default", { system_count: 9, capital_system: 1 }),
    country(2, "Keepers", "fallen_empire", { system_count: 4, capital_system: null }),
    country(3, "Awoken", "awakened_fallen_empire", { system_count: 5 }),
    country(4, "Traders", "enclave_trader"),
    country(5, "Amoebas", "amoeba"),
    country(6, "Caravans", "caravaneer_home"),
  ].map((c) => [c.id, c]),
);

function lane(to: number) {
  return { to, length: 10, bridge: false, stale: false };
}

function countryRef(id: number): CountryRef {
  return { id, name_key: `NAME_${id}`, name: null, country_type: "default", icon: null };
}

function special(id: number, extra: Partial<SpecialSystem> = {}): SpecialSystem {
  return {
    id,
    primary: "landmark",
    kinds: ["landmark"],
    initializer: "",
    initializer_known: true,
    source_file: null,
    flags: [],
    countries: [],
    label: "",
    ...extra,
  };
}

describe("the Empires tab", () => {
  const ownership = composeOwnership({
    kind: "save",
    systems: new Map(),
    countries: COUNTRIES,
    countryTypes: TYPES,
    mapColors: new Map(),
    countryName: LOOKUPS.countryName,
  });
  const groups = empireGroups(COUNTRIES, TYPES, LOOKUPS, ownership);
  const byKey = new Map(groups.map((g) => [g.key, g]));

  it("groups by type, drops the fauna and the enclaves, and sorts the biggest first", () => {
    expect(groups.map((g) => g.key)).toEqual(["empire", "fallen", "awakened", "caravaneer"]);
    expect(byKey.get("empire")?.rows.map((r) => r.name)).toEqual(["Blorg", "Humans"]);
    expect(byKey.get("fallen")?.rows.map((r) => r.name)).toEqual(["Keepers"]);
    expect(byKey.get("awakened")?.rows.map((r) => r.name)).toEqual(["Awoken"]);
    expect(groups.flatMap((g) => g.rows).map((r) => r.id)).not.toContain(4);
    expect(groups.flatMap((g) => g.rows).map((r) => r.id)).not.toContain(5);
  });

  it("sublines the capital and the system count, and falls back to the central system", () => {
    expect(byKey.get("empire")?.rows[1].subline).toBe("Sol · 3 systems");
    expect(byKey.get("empire")?.rows[0].subline).toBe("Alpha Centauri · 9 systems");
    const keepers = byKey.get("fallen")!.rows[0];
    expect(keepers.subline).toBe("no capital · 4 systems");
    expect(keepers.capital).toBe(3);
  });

  it("keeps file order as the index the owners palette follows", () => {
    expect(byKey.get("empire")?.rows.map((r) => r.index)).toEqual([1, 0]);
  });

  it("lists a scenario's marauder clan under the marauders, at its home, with no country", () => {
    const home = { ...systemNode({ id: 1, marauder: { home: 1 } }), lanes: [lane(2)] };
    const base = { ...systemNode({ id: 2, marauder: { base: 1 } }), lanes: [lane(1)] };
    const clans = composeOwnership({
      kind: "scenario",
      systems: new Map([
        [1, home],
        [2, base],
      ]),
      countries: COUNTRIES,
      countryTypes: TYPES,
      mapColors: new Map(),
      countryName: LOOKUPS.countryName,
    });
    const rows = empireGroups(COUNTRIES, TYPES, LOOKUPS, clans);
    const marauders = rows.find((g) => g.key === "marauder")!;
    expect(marauders.rows).toHaveLength(1);
    expect(marauders.rows[0]).toMatchObject({
      id: -1,
      country: null,
      name: "Marauder clan 1",
      systemCount: 2,
      capital: 1,
      subline: "Alpha Centauri · 2 systems",
    });
  });

  it("specialSystemOfCountry takes the first system a country appears in", () => {
    const where = specialSystemOfCountry(
      new Map([
        [7, special(7, { countries: [countryRef(4)] })],
        [8, special(8, { countries: [countryRef(4)] })],
      ]),
    );
    expect(where.get(4)).toBe(7);
  });
});

describe("the Points of interest tab", () => {
  const SPECIAL = new Map(
    [
      special(0, { primary: "landmark", kinds: ["landmark"] }),
      special(1, {
        primary: "leviathan",
        kinds: ["leviathan"],
        label: "Stellarite Devourer",
        initializer: "guardian_dragon",
      }),
      special(2, {
        primary: "unique",
        kinds: ["unique"],
        initializer: "distant_stars_01",
        source_file: "10_distant_stars_initializers.txt",
      }),
      special(3, {
        primary: "unique",
        kinds: ["unique"],
        initializer: "distant_stars_02",
        source_file: "10_distant_stars_initializers.txt",
      }),
      special(9, { primary: "marauder", kinds: ["marauder"] }),
    ].map((s) => [s.id, s]),
  );

  const groups = pointGroups(SPECIAL, true, new Map(), LOOKUPS.systemName);

  it("lists only the kinds the tab owns, in kind order, counting each", () => {
    expect(groups.map((g) => g.kind)).toEqual(["leviathan", "landmark", "unique"]);
    expect(groups.map((g) => g.count)).toEqual([1, 1, 2]);
  });

  it("names the system first for the kinds that read that way, and what stands there after", () => {
    const landmark = groups.find((g) => g.kind === "landmark")!;
    expect(landmark.rows).toEqual([{ id: 0, label: "Sol", subline: null }]);
    const leviathan = groups.find((g) => g.kind === "leviathan")!;
    expect(leviathan.rows[0]).toMatchObject({ id: 1, subline: "Alpha Centauri" });
  });

  it("splits the scripted systems by the file that defines them", () => {
    const scripted = groups.find((g) => g.kind === "unique")!;
    expect(scripted.rows).toEqual([]);
    expect(scripted.groups.map((g) => g.label)).toEqual(["Distant Stars"]);
    expect(scripted.groups[0].rows.map((r) => r.id)).toEqual([2, 3]);
  });
});

describe("the Issues tab", () => {
  const issue = (code: Issue["code"], severity: Issue["severity"], systems: number[]): Issue => ({
    severity,
    code,
    message: `${code} on ${systems.join(",")}`,
    systems,
    note: false,
  });

  it("groups by code, errors first then the biggest group, and names the systems", () => {
    const groups = issueGroups(
      [
        issue("system_isolated", "warning", [0]),
        issue("system_isolated", "warning", [2]),
        issue("disconnected", "error", [1, 3]),
      ],
      LOOKUPS.systemName,
    );
    expect(groups.map((g) => g.code)).toEqual(["disconnected", "system_isolated"]);
    expect(groups[0].error).toBe(true);
    expect(groups[0].title).toBe("Galaxy split into unconnected pieces");
    expect(groups[0].rows[0].systems).toBe("Alpha Centauri, Sirius");
    expect(groups[1].error).toBe(false);
    expect(groups[1].rows.map((r) => r.systems)).toEqual(["Sol", "Barnard"]);
  });
});
