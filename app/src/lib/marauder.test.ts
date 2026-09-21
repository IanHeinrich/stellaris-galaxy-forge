import { describe, expect, it } from "vitest";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import {
  basesBeside,
  CLANS,
  clanHomes,
  clanOf,
  homeBeside,
  homeInitializer,
  nextFreeClan,
} from "./marauder";

function systems(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

const lanes = (...to: number[]) =>
  to.map((id) => ({ to: id, length: 10, bridge: false, stale: false }));

const home = (id: number, clan: number, ...to: number[]) =>
  systemNode({ id, marauder: { home: clan }, lanes: lanes(...to) });
const base = (id: number, clan: number, ...to: number[]) =>
  systemNode({ id, marauder: { base: clan }, lanes: lanes(...to) });

describe("the clan vocabulary", () => {
  it("names the game's three clans and the initializer that makes a home", () => {
    expect(CLANS).toBe(3);
    for (const clan of [1, 2, 3]) expect(homeInitializer(clan)).toBe(`marauder_${clan}_1`);
    expect(clanOf({ home: 2 })).toBe(2);
    expect(clanOf({ base: 3 })).toBe(3);
  });
});

describe("clanHomes and nextFreeClan", () => {
  it("lists each clan's homes ascending, leaving out clans with none", () => {
    const placed = systems(home(9, 2), home(4, 2), home(1, 3), base(2, 1), systemNode({ id: 3 }));
    expect([...clanHomes(placed)]).toEqual([
      [2, [4, 9]],
      [3, [1]],
    ]);
  });

  it("offers the lowest clan without a home, and none once all three are placed", () => {
    expect(nextFreeClan(systems())).toBe(1);
    expect(nextFreeClan(systems(home(1, 1)))).toBe(2);
    expect(nextFreeClan(systems(home(1, 2)))).toBe(1);
    expect(nextFreeClan(systems(home(1, 1), home(2, 2), home(3, 3)))).toBeNull();
  });
});

describe("basesBeside and homeBeside", () => {
  it("finds the clan's bases across the home's lanes, and the home across a base's", () => {
    const h = home(1, 2, 2, 3, 4, 5);
    const ownBase = base(2, 2, 1);
    const otherClan = base(3, 1, 1);
    const otherHome = home(4, 1, 1);
    const plain = systemNode({ id: 5, lanes: lanes(1) });
    const all = systems(h, ownBase, otherClan, otherHome, plain);
    expect(basesBeside(h, all)).toEqual([ownBase]);
    expect(homeBeside(ownBase, all)).toBe(h);
    expect(homeBeside(otherClan, all)).toBeNull();
  });

  it("finds nothing for a system that is not a home, or a base with no linked home", () => {
    const b = base(2, 1, 3);
    const all = systems(b, home(3, 2, 2), systemNode({ id: 1 }));
    expect(basesBeside(b, all)).toEqual([]);
    expect(basesBeside(systemNode({ id: 1 }), all)).toEqual([]);
    expect(homeBeside(b, all)).toBeNull();
    expect(homeBeside(systemNode({ id: 1 }), all)).toBeNull();
  });
});
