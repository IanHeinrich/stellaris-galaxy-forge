import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { placedNode } from "../../test/builders";
import { bandOf, inRing, trimmedInner, type Region } from "./polygon";
import type { Pt } from "./pt";
import { countryRegions, InfluenceField } from "./territory";
import { PARAMS } from "./territory.fixture";

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

/** The band between the outline and its inner part, as the map draws it. */
const bandBetween = (outline: Region, inner: Region): Region =>
  bandOf(outline, trimmedInner(outline, inner));

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

/**
 * The tightest radius the ring bends through within `win` of `c`: the circle through points
 * a world unit either side of each point, the ring resampled every 0.2 world units.
 */
function cornerRadius(ring: Pt[], c: Pt, win = 6): number {
  const pts: Pt[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let t = 0; t < len; t += 0.2) {
      pts.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
    }
  });
  const n = pts.length;
  let tightest = Infinity;
  pts.forEach((b, i) => {
    if (Math.hypot(b.x - c.x, b.y - c.y) > win) return;
    const a = pts[(i - 5 + n) % n];
    const d = pts[(i + 5) % n];
    const sides = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y);
    const area = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / 2;
    if (area > 1e-9)
      tightest = Math.min(tightest, (sides * Math.hypot(d.x - a.x, d.y - a.y)) / (4 * area));
  });
  return tightest;
}

/** Every vertex of `part` lies inside `outline`, or is one of its own vertices. */
function within(part: Region, outline: Region): boolean {
  const own = new Set(outline.flat(2).map((p) => `${p.x},${p.y}`));
  return part.flat(2).every((p) => own.has(`${p.x},${p.y}`) || inRegion(p, outline));
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
    const east = [system(4, 40, -30, 20, [5]), system(5, 40, 0, 20, [4, 6]), system(6, 40, 30, 20)];
    const regions = countryRegions([...west, ...east], PARAMS);
    const a = regions.get(10)!;
    const b = regions.get(20)!;
    const theirs = new Set(b.flat(2).map((p) => `${p.x},${p.y}`));
    const shared = a.flat(2).filter((p) => p.x > 13 && p.x < 27 && Math.abs(p.y) < 30);
    expect(shared.length).toBeGreaterThan(5);
    for (const p of shared) expect(theirs.has(`${p.x},${p.y}`)).toBe(true);
    for (let x = 0; x <= 40; x += 0.7) {
      for (let y = -40; y <= 40; y += 3.1) {
        const p = { x, y };
        expect(Number(inRegion(p, a)) + Number(inRegion(p, b))).toBeLessThanOrEqual(1);
      }
    }
    expect(inRegion({ x: 19, y: 0 }, a)).toBe(true);
    expect(inRegion({ x: 21, y: 0 }, b)).toBe(true);
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
    expect(corner.x).toBeLessThan(21.5);
    const radius = cornerRadius(ring, corner);
    expect(radius).toBeGreaterThan(5);
    expect(radius).toBeLessThan(6);
  });

  it("joins two lobes' bands across the neck between them", () => {
    const field = new InfluenceField(PARAMS, null, 5);
    field.reset([system(1, 0, 0, 10), system(2, 58, 0, 10)]);
    const band = bandBetween(field.region(10), field.inner(10));
    expect(band).toHaveLength(1);
    expect(band[0]).toHaveLength(3);
    expect(inRegion({ x: 29, y: 0 }, band)).toBe(true);
    expect(inRegion({ x: 0, y: 0 }, band)).toBe(false);
    expect(inRegion({ x: 58, y: 0 }, band)).toBe(false);
  });

  it("merges two lobes' bands into one region that the inner part shows through at a waist", () => {
    const field = new InfluenceField(PARAMS, null, 5.9);
    field.reset([system(1, 0, 0, 10), system(2, 50, 0, 10)]);
    const inner = field.inner(10);
    const band = bandBetween(field.region(10), inner);
    expect(inner).toHaveLength(1);
    expect(band).toHaveLength(1);
    expect(inRegion({ x: 25, y: 0 }, inner)).toBe(true);
    expect(inRegion({ x: 25, y: 15 }, band)).toBe(true);
    expect(inRegion({ x: 25, y: -15 }, band)).toBe(true);
  });

  it("draws no band round the shallow middle of a sparse ring, but keeps it round a real hole", () => {
    const ring = (centre: SystemNode[]) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = (i * Math.PI) / 5;
        return system(i + 1, 40 * Math.cos(a), 40 * Math.sin(a), 10, [((i + 1) % 10) + 1]);
      }).concat(centre);
    const sparse = new InfluenceField(PARAMS, null, 5.9, 5.9 / 4);
    sparse.reset(ring([]));
    const outline = sparse.region(10);
    expect(outline).toEqual([[outline[0][0]]]);
    expect(sparse.inner(10)[0].length).toBeGreaterThan(1);
    for (const inner of [sparse.inner(10), sparse.seamInner(10)]) {
      const band = bandBetween(outline, inner);
      expect(band).toHaveLength(1);
      expect(inRegion({ x: 0, y: 0 }, band)).toBe(false);
    }
    const holed = new InfluenceField(PARAMS, null, 5.9, 5.9 / 4);
    holed.reset(ring([system(11, 0, 0, null)]));
    const territory = holed.region(10);
    expect(territory[0]).toHaveLength(2);
    const { maxX } = box(territory[0][1]);
    expect(inRegion({ x: maxX + 1, y: 0 }, bandBetween(territory, holed.inner(10)))).toBe(true);
  });

  it("keeps the band and its seam inside the territory at the widest band", () => {
    const scenes = [
      [system(1, 0, 0, 10), system(2, 58, 0, 10)],
      [system(1, 0, 0, 10)],
      [system(1, 0, 0, 10), system(2, 30, 0, 20), system(3, -30, 0, 30)],
    ];
    for (const scene of scenes) {
      const field = new InfluenceField(PARAMS, null, 5.9, 5.9 / 4);
      field.reset(scene);
      const outline = field.region(10);
      expect(outline.length).toBeGreaterThan(0);
      for (const inner of [field.inner(10), field.seamInner(10)]) {
        expect(within(inner, outline)).toBe(true);
        expect(within(bandBetween(outline, inner), outline)).toBe(true);
      }
    }
  });
});
