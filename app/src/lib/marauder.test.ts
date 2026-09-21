import { describe, expect, it } from "vitest";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import {
  BASE_CLEARANCE,
  baseInitializer,
  basesBeside,
  CLANS,
  clanHomes,
  clanOf,
  clanSystems,
  homeBeside,
  homeInitializer,
  missingBaseSites,
  nextFreeClan,
  placeBases,
} from "./marauder";

function systems(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

const lanes = (...to: number[]) =>
  to.map((id) => ({ to: id, length: 10, bridge: false, stale: false }));

const home = (id: number, clan: number, ...to: number[]) =>
  systemNode({
    id,
    marauder: { home: clan },
    initializer: homeInitializer(clan),
    lanes: lanes(...to),
  });
const base = (id: number, clan: number, site: 2 | 3, ...to: number[]) =>
  systemNode({
    id,
    marauder: { base: clan },
    initializer: baseInitializer(clan, site),
    lanes: lanes(...to),
  });

describe("the clan vocabulary", () => {
  it("names the game's three clans and the initializers of a home and its bases", () => {
    expect(CLANS).toBe(3);
    for (const clan of [1, 2, 3]) {
      expect(homeInitializer(clan)).toBe(`marauder_${clan}_1`);
      expect(baseInitializer(clan, 2)).toBe(`marauder_${clan}_2`);
      expect(baseInitializer(clan, 3)).toBe(`marauder_${clan}_3`);
    }
    expect(clanOf({ home: 2 })).toBe(2);
    expect(clanOf({ base: 3 })).toBe(3);
  });
});

describe("clanHomes and nextFreeClan", () => {
  it("lists each clan's homes ascending, leaving out clans with none", () => {
    const placed = systems(
      home(9, 2),
      home(4, 2),
      home(1, 3),
      base(2, 1, 2),
      systemNode({ id: 3 }),
    );
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

describe("basesBeside, homeBeside and clanSystems", () => {
  it("finds the clan's bases across the home's lanes, and the home across a base's", () => {
    const h = home(1, 2, 2, 3, 4, 5);
    const ownBase = base(2, 2, 2, 1);
    const otherClan = base(3, 1, 2, 1);
    const otherHome = home(4, 1, 1);
    const plain = systemNode({ id: 5, lanes: lanes(1) });
    const all = systems(h, ownBase, otherClan, otherHome, plain);
    expect(basesBeside(h, all)).toEqual([ownBase]);
    expect(homeBeside(ownBase, all)).toBe(h);
    expect(homeBeside(otherClan, all)).toBeNull();
    expect(clanSystems(2, all)).toEqual([1, 2]);
    expect(clanSystems(1, all)).toEqual([3, 4]);
    expect(clanSystems(3, all)).toEqual([]);
  });

  it("finds nothing for a system that is not a home, or a base with no linked home", () => {
    const b = base(2, 1, 2, 3);
    const all = systems(b, home(3, 2, 2), systemNode({ id: 1 }));
    expect(basesBeside(b, all)).toEqual([]);
    expect(basesBeside(systemNode({ id: 1 }), all)).toEqual([]);
    expect(homeBeside(b, all)).toBeNull();
    expect(homeBeside(systemNode({ id: 1 }), all)).toBeNull();
  });
});

describe("missingBaseSites", () => {
  it("names the sites a home has no base beside it for, by the bases' initializers", () => {
    const h = home(1, 1, 2, 3);
    expect(missingBaseSites(h, systems(h))).toEqual([2, 3]);
    expect(missingBaseSites(h, systems(h, base(2, 1, 2, 1)))).toEqual([3]);
    expect(missingBaseSites(h, systems(h, base(3, 1, 3, 1)))).toEqual([2]);
    expect(missingBaseSites(h, systems(h, base(2, 1, 2, 1), base(3, 1, 3, 1)))).toEqual([]);
  });

  it("counts two bases as complete whatever their sites say", () => {
    const h = home(1, 1, 2, 3);
    expect(missingBaseSites(h, systems(h, base(2, 1, 2, 1), base(3, 1, 2, 1)))).toEqual([]);
  });
});

describe("placeBases", () => {
  const at = (id: number, x: number, y: number) => systemNode({ id, x, y });

  it("puts base 2 at 20 north of the home and base 3 at 25 on another bearing", () => {
    const h = at(1, 100, 100);
    const [second, third] = placeBases(h, [2, 3], [h]);
    expect(second.site).toBe(2);
    expect([second.x, second.y]).toEqual([100, 80]);
    expect(third.site).toBe(3);
    expect(Math.hypot(third.x - 100, third.y - 100)).toBeCloseTo(25);
    expect(Math.hypot(third.x - second.x, third.y - second.y)).toBeGreaterThan(BASE_CLEARANCE);
  });

  it("nudges the bearing round until the site keeps clear of every system", () => {
    const h = at(1, 0, 0);
    const blocker = at(2, 0, -20);
    const [second] = placeBases(h, [2], [h, blocker]);
    expect(Math.hypot(second.x, second.y)).toBeCloseTo(20);
    expect(Math.hypot(second.x - blocker.x, second.y - blocker.y)).toBeGreaterThanOrEqual(
      BASE_CLEARANCE,
    );
    expect(second.x).toBeGreaterThan(0);
  });

  it("places only the sites asked for", () => {
    expect(placeBases(at(1, 0, 0), [3], []).map((p) => p.site)).toEqual([3]);
    expect(placeBases(at(1, 0, 0), [], [])).toEqual([]);
  });
});
