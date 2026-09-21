import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { name, systemNode } from "../../test/builders";
import { Territories, type Shape } from "./territories";
import { countryRegions, regionLabelAnchor, smoothRegion } from "./territory";

const PARAMS = { radius: 35, laneHalfWidth: 10 };
const BORDERED = [10, 20, 30];

const system = (id: number, x: number, y: number, owner: number | null): SystemNode =>
  systemNode({ id, name: name(`NAME_${id}`), x, y, owner });

/** Country 10 holds 1 and 4, country 20 holds 2, and country 30 holds 3, well out of reach. */
function galaxy(): SystemNode[] {
  return [system(1, 0, 0, 10), system(4, 40, 0, 10), system(2, 300, 0, 20), system(3, 0, 600, 30)];
}

function direct(systems: SystemNode[]): Map<number, Shape> {
  const shapes = new Map<number, Shape>();
  for (const [id, region] of countryRegions(systems, PARAMS, new Set(BORDERED))) {
    shapes.set(id, { smoothed: smoothRegion(region), anchor: regionLabelAnchor(region) });
  }
  return shapes;
}

describe("Territories", () => {
  it("resets to every bordered country's smoothed region and anchor", () => {
    const shapes = new Territories().reset(galaxy(), PARAMS, BORDERED);
    expect([...shapes.keys()].sort()).toEqual([10, 20, 30]);
    expect(shapes).toEqual(direct(galaxy()));
  });

  it("applies a move to the countries it reaches and leaves the far one alone", () => {
    const territories = new Territories();
    territories.reset(galaxy(), PARAMS, BORDERED);
    const moved = system(4, 260, 0, 10);
    const { shapes, removed } = territories.apply([moved], []);
    expect([...shapes.keys()].sort()).toEqual([10, 20]);
    expect(removed).toEqual([]);
    const fresh = direct(galaxy().map((s) => (s.id === 4 ? moved : s)));
    expect(shapes.get(10)).toEqual(fresh.get(10));
    expect(shapes.get(20)).toEqual(fresh.get(20));
  });

  it("reports a country whose last system was removed and nothing else", () => {
    const territories = new Territories();
    territories.reset(galaxy(), PARAMS, BORDERED);
    const { shapes, removed } = territories.apply([], [2]);
    expect(shapes.size).toBe(0);
    expect(removed).toEqual([20]);
  });

  it("answers an apply before any reset with nothing", () => {
    const { shapes, removed } = new Territories().apply([system(1, 0, 0, 10)], [2]);
    expect(shapes.size).toBe(0);
    expect(removed).toEqual([]);
  });
});
