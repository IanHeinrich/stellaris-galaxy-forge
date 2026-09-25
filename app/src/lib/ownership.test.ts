import { describe, expect, it } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { MarauderRole } from "../generated/MarauderRole";
import type { SystemNode } from "../generated/SystemNode";
import { byId, countryNode, systemNode } from "../test/builders";
import {
  clanSystemsOf,
  composeOwnership,
  ownerTerritoryKind,
  settledOwnership,
  supersededCountry,
  systemsOf,
  type OwnershipInput,
} from "./ownership";
import { MARAUDER_COLORS } from "./visual/ownerColors";

function country(id: number, key: string, type: string): CountryNode {
  return countryNode({
    id,
    name: { key, literal: false, variables: [] },
    name_key: key,
    country_type: type,
    capital_system: null,
    system_count: 0,
  });
}

/** A system owned by `owner`, in `role`, with lanes to `to`. */
function system(
  id: number,
  owner: number | null,
  role: MarauderRole | null = null,
  ...to: number[]
): SystemNode {
  return systemNode({
    id,
    x: id * 30,
    owner,
    marauder: role,
    lanes: to.map((other) => ({ to: other, length: 10, bridge: false, stale: false })),
  });
}

const EMPIRE = country(7, "Empire", "default");
const ENCLAVE = country(8, "Traders", "enclave");
const SCRIPTED_CLAN = country(9, "Clan", "dormant_marauders");
const NO_TYPES = new Map();

function input(over: Partial<OwnershipInput>): OwnershipInput {
  return {
    kind: "save",
    systems: new Map(),
    countries: new Map(),
    countryTypes: NO_TYPES,
    mapColors: new Map(),
    countryName: (c) => c.name_key,
    ...over,
  };
}

describe("composeOwnership", () => {
  it("takes a save's owners from its systems and lists the countries that draw borders", () => {
    const { owners, table } = composeOwnership(
      input({
        systems: byId(system(1, 7), system(2, 8), system(3, null)),
        countries: new Map([
          [7, EMPIRE],
          [8, ENCLAVE],
        ]),
      }),
    );
    expect([...owners]).toEqual([
      [1, 7],
      [2, 8],
    ]);
    expect([...table.keys()]).toEqual([7]);
    expect(table.get(7)).toMatchObject({
      id: 7,
      label: "Empire",
      kind: "country",
      country: EMPIRE,
    });
  });

  it("leaves a save's marauder clans as the countries they are", () => {
    const { owners, table } = composeOwnership(
      input({
        systems: byId(system(1, 9, { home: 1 }, 2), system(2, 9, { base: 1 }, 1)),
        countries: new Map([[9, SCRIPTED_CLAN]]),
      }),
    );
    expect(owners.get(1)).toBe(9);
    expect([...table.keys()]).toEqual([9]);
    expect(ownerTerritoryKind(table.get(9), NO_TYPES)).toBe("marauder");
  });

  it("makes each of a scenario's clans one owner and drops the scripted country behind it", () => {
    const home = system(1, 9, { home: 1 }, 2, 3);
    const baseA = system(2, 9, { base: 1 }, 1);
    const baseB = system(3, null, { base: 1 }, 1);
    const stray = system(4, null, { base: 2 });
    const owned = system(5, 7);
    const claimed = system(6, 7, null, 5);
    const ownership = composeOwnership(
      input({
        kind: "scenario",
        systems: byId(home, baseA, baseB, stray, owned, claimed),
        countries: new Map([
          [7, EMPIRE],
          [9, SCRIPTED_CLAN],
        ]),
      }),
    );
    const { owners, table } = ownership;
    expect([...table.keys()]).toEqual([7, -1]);
    expect(table.get(-1)).toMatchObject({
      id: -1,
      label: "Marauder clan 1",
      kind: "marauder_clan",
      colors: MARAUDER_COLORS,
      home: 1,
    });
    expect(table.get(-1)?.country).toBeUndefined();
    expect(systemsOf(owners, -1)).toEqual([1, 2, 3]);
    expect(systemsOf(owners, 7)).toEqual([5, 6]);
    expect(owners.has(4)).toBe(false);
    expect(clanSystemsOf(ownership)).toEqual(new Set([1, 2, 3]));
    expect(supersededCountry(ownership, SCRIPTED_CLAN, NO_TYPES)).toBe(true);
    expect(supersededCountry(ownership, EMPIRE, NO_TYPES)).toBe(false);
    expect(ownerTerritoryKind(table.get(-1), NO_TYPES)).toBe("marauder");
  });

  it("keeps a scripted marauder country that holds a system of no clan, for that system", () => {
    const { owners, table } = composeOwnership(
      input({
        kind: "scenario",
        systems: byId(system(1, 9, { home: 1 }, 2), system(2, 9, { base: 1 }, 1), system(3, 9)),
        countries: new Map([[9, SCRIPTED_CLAN]]),
      }),
    );
    expect([...table.keys()]).toEqual([9, -1]);
    expect(systemsOf(owners, -1)).toEqual([1, 2]);
    expect(systemsOf(owners, 9)).toEqual([3]);
  });

  it("keeps a second clan apart from the first, and a base of no home out of both", () => {
    const { owners, table } = composeOwnership(
      input({
        kind: "scenario",
        systems: byId(
          system(1, null, { home: 1 }, 2),
          system(2, null, { base: 1 }, 1),
          system(3, null, { home: 2 }, 4),
          system(4, null, { base: 2 }, 3),
          system(5, null, { base: 2 }),
        ),
      }),
    );
    expect([...table.keys()]).toEqual([-1, -2]);
    expect(systemsOf(owners, -1)).toEqual([1, 2]);
    expect(systemsOf(owners, -2)).toEqual([3, 4]);
    expect(owners.has(5)).toBe(false);
  });
});

describe("settledOwnership", () => {
  it("keeps the halves an edit left as they were, by identity", () => {
    const systems = byId(system(1, 7), system(2, 7));
    const countries = new Map([[7, EMPIRE]]);
    const first = composeOwnership(input({ systems, countries }));
    const moved = byId({ ...system(1, 7), x: 99 }, system(2, 7));
    const again = settledOwnership(first, composeOwnership(input({ systems: moved, countries })));
    expect(again).toBe(first);

    const reowned = byId(system(1, 7), system(2, null));
    const changed = settledOwnership(
      first,
      composeOwnership(input({ systems: reowned, countries })),
    );
    expect(changed).not.toBe(first);
    expect(changed.owners).not.toBe(first.owners);
    expect(changed.table).toBe(first.table);
  });
});
