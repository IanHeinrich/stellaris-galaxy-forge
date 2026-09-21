import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { name, systemNode } from "../../test/builders";
import { Territories, type Shape } from "./territories";
import { countryRegions, regionLabelAnchor, ringArea, smoothRegion } from "./territory";
import { buildGalaxy } from "./territory.fixture";

const PARAMS = { radius: 35, laneHalfWidth: 10 };
const BORDERED = [10, 20, 30];

const system = (id: number, x: number, y: number, owner: number | null): SystemNode =>
  systemNode({ id, name: name(`NAME_${id}`), x, y, owner });

/** Country 10 holds 1 and 4, country 20 holds 2, and country 30 holds 3, well out of reach. */
function galaxy(): SystemNode[] {
  return [system(1, 0, 0, 10), system(4, 40, 0, 10), system(2, 300, 0, 20), system(3, 0, 600, 30)];
}

function direct(systems: SystemNode[], bordered = BORDERED): Map<number, Shape> {
  const shapes = new Map<number, Shape>();
  for (const [id, region] of countryRegions(systems, PARAMS, new Set(bordered))) {
    shapes.set(id, { smoothed: smoothRegion(region), anchor: regionLabelAnchor(region) });
  }
  return shapes;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** The two-level union of the tiles lands each vertex within rounding of the flat union's. */
const VERTEX_TOLERANCE = 1e-9;
const AREA_TOLERANCE = 1e-6;

function expectSameShape(got: Shape, want: Shape): void {
  expect(got.smoothed).toHaveLength(want.smoothed.length);
  for (let i = 0; i < want.smoothed.length; i++) {
    const g = got.smoothed[i][0];
    const w = want.smoothed[i][0];
    expect(g).toHaveLength(w.length);
    const area = Math.abs(ringArea(w));
    expect(Math.abs(Math.abs(ringArea(g)) - area) / area).toBeLessThan(AREA_TOLERANCE);
    let farthest = 0;
    for (let k = 0; k < w.length; k++) farthest = Math.max(farthest, Math.sqrt(dist2(g[k], w[k])));
    expect(farthest).toBeLessThan(VERTEX_TOLERANCE);
  }
  expect(got.anchor === null).toBe(want.anchor === null);
  if (got.anchor && want.anchor) {
    for (const k of ["x", "y", "inradius", "extent", "width", "height"] as const) {
      expect(Math.abs(got.anchor[k] - want.anchor[k])).toBeLessThan(VERTEX_TOLERANCE);
    }
  }
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

  it("matches countryRegions after moves inside, across a border, a removal and a change of owner", () => {
    const { systems, sizes } = buildGalaxy();
    const bordered = sizes.map((s) => s.country);
    const [largest, second] = [sizes[0].country, sizes[1].country];
    const own = systems.filter((s) => s.owner === largest);
    const foreign = systems.filter((s) => s.owner !== largest);
    const nearest = (s: SystemNode): SystemNode =>
      foreign.reduce((best, f) => (dist2(f, s) < dist2(best, s) ? f : best));

    const territories = new Territories();
    const latest = territories.reset(systems, PARAMS, bordered);
    let galaxy = systems;
    const step = (changed: SystemNode[], removed: number[]): void => {
      galaxy = galaxy
        .filter((s) => !removed.includes(s.id))
        .map((s) => changed.find((c) => c.id === s.id) ?? s);
      const { shapes, removed: emptied } = territories.apply(changed, removed);
      for (const [id, shape] of shapes) latest.set(id, shape);
      for (const id of emptied) latest.delete(id);
    };

    const inside = own[0];
    step([{ ...inside, x: inside.x + 20 }], []);
    const crossing = own[Math.floor(own.length / 2)];
    const across = nearest(crossing);
    step([{ ...crossing, x: 2 * across.x - crossing.x, y: 2 * across.y - crossing.y }], []);
    step([], [own[own.length - 1].id]);
    const defector = systems.find((s) => s.owner === second) as SystemNode;
    step([{ ...defector, owner: largest }], []);

    const compared = sizes.slice(0, 4).map((s) => s.country);
    const fresh = direct(galaxy, compared);
    for (const country of compared) expectSameShape(latest.get(country)!, fresh.get(country)!);
  });

  it("answers an apply before any reset with nothing", () => {
    const { shapes, removed } = new Territories().apply([system(1, 0, 0, 10)], [2]);
    expect(shapes.size).toBe(0);
    expect(removed).toEqual([]);
  });
});
