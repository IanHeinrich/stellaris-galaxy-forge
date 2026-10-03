import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { placedNode } from "../../test/builders";
import type { Pt } from "./pt";
import { bandOf, countryRegions, InfluenceField, type Region } from "./territory";

const PARAMS = { radius: 35, laneHalfWidth: 10 };

const system = (
  id: number,
  x: number,
  y: number,
  owner: number | null,
  lanes: number[] = [],
): SystemNode => ({ ...placedNode(id, x, y, lanes), owner });

/** Six systems of `owner` round the origin at the given distances, each laned to the next. */
function ringOf(owner: number, distances: number[], lanesToCentre = false): SystemNode[] {
  return distances.map((d, i) => {
    const a = (i * Math.PI) / 3;
    const lanes = [((i + 1) % 6) + 1, ((i + 5) % 6) + 1, ...(lanesToCentre ? [7] : [])];
    return system(i + 1, d * Math.cos(a), d * Math.sin(a), owner, lanes);
  });
}

function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function inRegion(p: Pt, region: Region): boolean {
  return region.some(
    (polygon) => inRing(p, polygon[0]) && polygon.slice(1).every((hole) => !inRing(p, hole)),
  );
}

function box(ring: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxX: Math.max(...ring.map((p) => p.x)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

describe("countryRegions", () => {
  it("leaves an off-centre oval hole round an unowned system its neighbours crowd unevenly", () => {
    const region = countryRegions(
      [...ringOf(10, [30, 34, 42, 48, 42, 34]), system(7, 0, 0, null)],
      PARAMS,
    ).get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(2);
    const hole = region[0][1];
    expect(inRing({ x: 0, y: 0 }, hole)).toBe(true);
    const { minX, minY, maxX, maxY } = box(hole);
    expect(maxX - minX).toBeGreaterThan(20);
    expect(maxX - minX).toBeLessThan(45);
    expect(maxY - minY).toBeGreaterThan(20);
    expect(maxY - minY).toBeLessThan(45);
    // The near neighbour on the right pushes the hole away from it.
    expect(-minX - maxX).toBeGreaterThan(4);
    expect(Math.abs(minY + maxY)).toBeLessThan(0.5);
  });

  it("gives a one-system pocket a round piece reaching half-way to its neighbours", () => {
    const regions = countryRegions(
      [...ringOf(10, Array(6).fill(40), true), system(7, 0, 0, 20, [1, 2, 3, 4, 5, 6])],
      PARAMS,
    );
    const pocket = regions.get(20)!;
    expect(pocket).toHaveLength(1);
    const { minX, minY, maxX, maxY } = box(pocket[0][0]);
    for (const reach of [-minX, maxX, -minY, maxY]) {
      expect(reach).toBeGreaterThan(0.4 * 40);
      expect(reach).toBeLessThan(0.6 * 40);
    }
    expect(regions.get(10)![0]).toHaveLength(2);
  });

  it("gives two touching countries the same vertices along their border and no overlap", () => {
    const west = [system(1, 0, -30, 10, [2]), system(2, 0, 0, 10, [1, 3]), system(3, 0, 30, 10)];
    const east = [system(4, 44, -30, 20, [5]), system(5, 44, 0, 20, [4, 6]), system(6, 44, 30, 20)];
    const regions = countryRegions([...west, ...east], PARAMS);
    const a = regions.get(10)!;
    const b = regions.get(20)!;
    const theirs = new Set(b.flat(2).map((p) => `${p.x},${p.y}`));
    const shared = a.flat(2).filter((p) => p.x > 15 && p.x < 29 && Math.abs(p.y) < 30);
    expect(shared.length).toBeGreaterThan(5);
    for (const p of shared) expect(theirs.has(`${p.x},${p.y}`)).toBe(true);
    for (let x = 0; x <= 44; x += 0.7) {
      for (let y = -40; y <= 40; y += 3.1) {
        const p = { x, y };
        expect(Number(inRegion(p, a)) + Number(inRegion(p, b))).toBeLessThanOrEqual(1);
      }
    }
    expect(inRegion({ x: 21, y: 0 }, a)).toBe(true);
    expect(inRegion({ x: 23, y: 0 }, b)).toBe(true);
  });

  it("draws only the countries asked for, while every owner claims its space", () => {
    const nodes = [system(1, 0, 0, 10), system(2, 40, 0, 20), system(3, 0, 80, null)];
    const regions = countryRegions(nodes, PARAMS, new Set([10]));
    expect([...regions.keys()]).toEqual([10]);
    expect(inRegion({ x: 25, y: 0 }, regions.get(10)!)).toBe(false);
    expect(countryRegions([system(1, 0, 0, null)], PARAMS).size).toBe(0);
    const same = countryRegions([system(1, 5, 5, 10, [2]), system(2, 5, 5, 10, [1])], PARAMS);
    expect(same.get(10)).toHaveLength(1);
  });

  it("rounds the corner where two countries and an unowned system meet", () => {
    const nodes = [system(1, 0, 0, 10), system(2, 44, 0, 20), system(3, 22, 36, null)];
    const ring = countryRegions(nodes, PARAMS).get(10)![0][0];
    const corner = ring.reduce((a, b) => (Math.abs(b.x - 22) < 2 && b.y > a.y ? b : a), {
      x: 0,
      y: -Infinity,
    });
    const near = ring.filter((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 4);
    expect(near.length).toBeGreaterThan(4);
    expect(corner.x).toBeLessThan(21.5);
  });

  it("joins two lobes' bands across the neck between them", () => {
    const field = new InfluenceField(PARAMS, null, 5);
    field.reset([system(1, 0, 0, 10), system(2, 58, 0, 10)]);
    const band = bandOf(field.region(10), field.inner(10));
    expect(band).toHaveLength(1);
    expect(band[0]).toHaveLength(3);
    expect(inRegion({ x: 29, y: 0 }, band)).toBe(true);
    expect(inRegion({ x: 0, y: 0 }, band)).toBe(false);
    expect(inRegion({ x: 58, y: 0 }, band)).toBe(false);
  });
});
