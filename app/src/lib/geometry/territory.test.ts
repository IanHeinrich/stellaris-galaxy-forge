import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { name, systemNode } from "../../test/builders";
import type { Pt } from "./pt";
import {
  affectedCountries,
  countryRegions,
  regionLabelAnchor,
  relaxRing,
  smoothRegion,
  smoothRing,
  type Region,
} from "./territory";

const PARAMS = { radius: 35, laneHalfWidth: 10 };

const system = (
  id: number,
  x: number,
  y: number,
  owner: number | null,
  lanes: number[] = [],
): SystemNode =>
  systemNode({
    id,
    name: name(`NAME_${id}`),
    x,
    y,
    lanes: lanes.map((to) => ({ to, length: 0, bridge: false, stale: false })),
    owner,
  });

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

function byId(nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

function bounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function regionArea(region: Region): number {
  let sum = 0;
  for (const [ring] of region) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
    }
  }
  return Math.abs(sum / 2);
}

const DISC_AREA = Math.PI * PARAMS.radius ** 2;

describe("countryRegions", () => {
  it("gives two neighbouring owners regions that meet without overlapping", () => {
    const a = system(1, 0, 0, 10);
    const b = system(2, 40, 0, 20);
    const regions = countryRegions([a, b], PARAMS);
    const ra = regions.get(10)!;
    const rb = regions.get(20)!;
    expect(inRegion(a, ra)).toBe(true);
    expect(inRegion(b, rb)).toBe(true);
    const steps = 37;
    for (let i = 0; i <= steps; i++) {
      const p = { x: (40 * i) / steps, y: 0 };
      expect(Number(inRegion(p, ra)) + Number(inRegion(p, rb))).toBeLessThanOrEqual(1);
    }
    expect(inRegion({ x: 19, y: 0 }, ra)).toBe(true);
    expect(inRegion({ x: 21, y: 0 }, rb)).toBe(true);
  });

  it("stops half-way to an unowned neighbour instead of covering it", () => {
    const owned = system(1, 0, 0, 10);
    const empty = system(2, 40, 0, null);
    const region = countryRegions([owned, empty], PARAMS).get(10)!;
    expect(region).toHaveLength(1);
    expect(inRegion({ x: 19, y: 0 }, region)).toBe(true);
    expect(inRegion({ x: 21, y: 0 }, region)).toBe(false);
    expect(inRegion({ x: 19, y: 20 }, region)).toBe(true);
    expect(inRegion({ x: 21, y: 20 }, region)).toBe(false);
    expect(inRegion({ x: -30, y: 0 }, region)).toBe(true);
    expect(inRegion(empty, region)).toBe(false);
  });

  it("unions two unlaned neighbours of one owner into a single polygon", () => {
    const region = countryRegions([system(1, 0, 0, 10), system(2, 40, 0, 10)], PARAMS).get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    for (const x of [-30, 0, 19, 20, 21, 40, 70]) expect(inRegion({ x, y: 0 }, region)).toBe(true);
    expect(inRegion({ x: 20, y: 25 }, region)).toBe(true);
  });

  it("leaves no hole where three same-owner discs meet at the edge of their reach", () => {
    const side = 60;
    const h = (side * Math.sqrt(3)) / 2;
    const region = countryRegions(
      [system(1, 0, 0, 10), system(2, side, 0, 10), system(3, side / 2, h, 10)],
      PARAMS,
    ).get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    expect(inRegion({ x: side / 2, y: h / 3 }, region)).toBe(true);
    for (const x of [-30, 0, 30, 60, 90]) expect(inRegion({ x, y: 0 }, region)).toBe(true);
  });

  it("drops a 1-unit² sliver and the hole it would leave in the surrounding owner", () => {
    const boxed = system(1, 0, 0, 10);
    const around = [
      system(2, 1, 0, 20),
      system(3, -1, 0, 20),
      system(4, 0, 1, 20),
      system(5, 0, -1, 20),
    ];
    const regions = countryRegions([boxed, ...around], PARAMS);
    expect(regions.has(10)).toBe(false);
    const region = regions.get(20)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    expect(inRegion({ x: 0, y: 0 }, region)).toBe(true);
  });

  it("keeps a dense cluster of one owner as one solid polygon", () => {
    const nodes: SystemNode[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) nodes.push(system(i * 5 + j, i * 30 + j * 3, j * 30, 10));
    }
    const region = countryRegions(nodes, PARAMS).get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    for (const s of nodes) expect(inRegion({ x: s.x + 15, y: s.y + 15 }, region)).toBe(true);
  });

  it("joins two laned systems of one owner into a single polygon", () => {
    const regions = countryRegions([system(1, 0, 0, 10, [2]), system(2, 60, 0, 10, [1])], PARAMS);
    const region = regions.get(10)!;
    expect(region).toHaveLength(1);
    expect(inRegion({ x: 30, y: 0 }, region)).toBe(true);
  });

  it("bridges a lane longer than two radii with a band", () => {
    const laned = countryRegions([system(1, 0, 0, 10, [2]), system(2, 100, 0, 10, [1])], PARAMS);
    expect(laned.get(10)).toHaveLength(1);
    expect(inRegion({ x: 50, y: 0 }, laned.get(10)!)).toBe(true);
    expect(inRegion({ x: 50, y: 12 }, laned.get(10)!)).toBe(false);
    const unlaned = countryRegions([system(1, 0, 0, 10), system(2, 100, 0, 10)], PARAMS);
    expect(unlaned.get(10)).toHaveLength(2);
  });

  it("merges a dense laned row beside unowned systems into one hole-free polygon", () => {
    const regions = countryRegions(
      [
        system(1, 0, 0, 10, [2]),
        system(2, 22, 0, 10, [1, 3]),
        system(3, 44, 0, 10, [2]),
        system(4, 11, 18, null),
        system(5, 33, -18, null),
        system(6, 60, 5, null),
      ],
      PARAMS,
    );
    const region = regions.get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    expect(regionArea(region)).toBeGreaterThan(0.8 * DISC_AREA);
    expect(regionArea(region)).toBeLessThan(3 * DISC_AREA);
    for (const x of [0, 11, 22, 33, 44]) expect(inRegion({ x, y: 0 }, region)).toBe(true);
    expect(inRegion({ x: 11, y: 18 }, region)).toBe(false);
  });

  it("merges a laned T junction into one hole-free polygon", () => {
    const regions = countryRegions(
      [
        system(1, 0, 0, 10, [2]),
        system(2, 60, 0, 10, [1, 3, 4]),
        system(3, 120, 0, 10, [2]),
        system(4, 60, 90, 10, [2]),
        system(5, 0, 90, null),
      ],
      PARAMS,
    );
    const region = regions.get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    for (const p of [
      { x: 30, y: 0 },
      { x: 90, y: 0 },
      { x: 60, y: 45 },
      { x: 60, y: 90 },
    ]) {
      expect(inRegion(p, region)).toBe(true);
    }
    expect(inRegion({ x: 0, y: 90 }, region)).toBe(false);
    expect(inRegion({ x: 25, y: 85 }, region)).toBe(false);
  });

  it("severs a band around an unowned system that is nearer than both ends", () => {
    const regions = countryRegions(
      [system(1, 0, 0, 10, [2]), system(2, 110, 0, 10, [1]), system(3, 55, 8, null)],
      PARAMS,
    );
    const region = regions.get(10)!;
    expect(inRegion({ x: 20, y: 0 }, region)).toBe(true);
    expect(inRegion({ x: 90, y: 0 }, region)).toBe(true);
    expect(inRegion({ x: 55, y: 0 }, region)).toBe(false);
    for (const p of [
      { x: 55, y: 3 },
      { x: 51, y: 8 },
      { x: 59, y: 8 },
      { x: 55, y: 10 },
    ]) {
      expect(inRegion(p, region)).toBe(false);
    }
  });

  it("fills a laned triangle without a hole", () => {
    const h = (50 * Math.sqrt(3)) / 2;
    const regions = countryRegions(
      [system(1, 0, 0, 10, [2, 3]), system(2, 50, 0, 10, [1, 3]), system(3, 25, h, 10, [1, 2])],
      PARAMS,
    );
    const region = regions.get(10)!;
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveLength(1);
    expect(inRegion({ x: 25, y: h / 3 }, region)).toBe(true);
  });

  it("gives an unowned system nothing", () => {
    expect(countryRegions([system(1, 0, 0, null)], PARAMS).size).toBe(0);
  });

  it("keeps a foreign lane band out of a disc and the disc out of the band", () => {
    const owner = system(1, 0, 0, 10);
    const p = system(2, 80, 15, 20, [3]);
    const q = system(3, -80, 15, 20, [2]);
    const regions = countryRegions([owner, p, q], PARAMS);
    const disc = regions.get(10)!;
    const band = regions.get(20)!;
    for (let x = -30; x <= 30; x += 3) {
      for (const y of [0, 5, 10, 14, 20, 25]) {
        const pt = { x, y };
        expect(Number(inRegion(pt, disc)) + Number(inRegion(pt, band))).toBeLessThanOrEqual(1);
      }
    }
    expect(inRegion({ x: 0, y: 0 }, disc)).toBe(true);
    expect(inRegion({ x: 0, y: 20 }, band)).toBe(false);
    expect(inRegion({ x: 60, y: 20 }, band)).toBe(true);
  });

  it("limits the work to `only` while still clipping against other owners", () => {
    const a = system(1, 0, 0, 10);
    const b = system(2, 40, 0, 20);
    const regions = countryRegions([a, b], PARAMS, new Set([10]));
    expect([...regions.keys()]).toEqual([10]);
    expect(inRegion({ x: 25, y: 0 }, regions.get(10)!)).toBe(false);
  });

  it("survives two systems at the same point", () => {
    expect(() => countryRegions([system(1, 5, 5, 10), system(2, 5, 5, 20)], PARAMS)).not.toThrow();
    const same = countryRegions([system(1, 5, 5, 10), system(2, 5, 5, 10)], PARAMS);
    expect(same.get(10)).toHaveLength(1);
  });
});

describe("smoothRing", () => {
  const square: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("doubles the point count per iteration", () => {
    expect(smoothRing(square, 0)).toHaveLength(4);
    expect(smoothRing(square, 1)).toHaveLength(8);
    expect(smoothRing(square)).toHaveLength(8);
    expect(smoothRing(square, 3)).toHaveLength(32);
  });

  it("stays within the input's bounding box", () => {
    const ring: Pt[] = [
      { x: -5, y: 2 },
      { x: 30, y: -7 },
      { x: 41, y: 20 },
      { x: 12, y: 33 },
      { x: 3, y: 18 },
    ];
    const box = bounds(ring);
    for (const p of smoothRing(ring, 3)) {
      expect(p.x).toBeGreaterThanOrEqual(box.minX);
      expect(p.x).toBeLessThanOrEqual(box.maxX);
      expect(p.y).toBeGreaterThanOrEqual(box.minY);
      expect(p.y).toBeLessThanOrEqual(box.maxY);
    }
  });

  it("cuts a square's corners", () => {
    const out = smoothRing(square);
    for (const corner of square) {
      expect(out.some((p) => p.x === corner.x && p.y === corner.y)).toBe(false);
    }
    expect(smoothRing(square, 1)).toContainEqual({ x: 2.5, y: 0 });
  });

  it("smooths every ring of a region", () => {
    const region: Region = [[square], [square.map((p) => ({ x: p.x + 50, y: p.y }))]];
    const smoothed = smoothRegion(region, 1);
    expect(smoothed).toHaveLength(2);
    expect(smoothed[0][0].length).toBeGreaterThan(8);
    expect(smoothed[1][0].length).toBeGreaterThan(8);
    expect(region[0][0]).toHaveLength(4);
  });
});

describe("relaxRing", () => {
  function circle(r: number, n: number): Pt[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }

  it("resamples the outline at the step and keeps a disc a disc", () => {
    const out = relaxRing(circle(35, 24), 4, 10);
    expect(out.length).toBeGreaterThan(24);
    for (const p of out) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThan(32);
      expect(r).toBeLessThan(35.01);
    }
  });

  it("fills the notch where two discs meet", () => {
    const a = circle(35, 24);
    const b = circle(35, 24).map((p) => ({ x: p.x + 40, y: p.y }));
    const [union] = polygonClipping.union(
      [[a.map((p) => [p.x, p.y] as [number, number])]],
      [[b.map((p) => [p.x, p.y] as [number, number])]],
    );
    const ring = union[0].slice(0, -1).map(([x, y]) => ({ x, y }));
    const notchDepth = (pts: Pt[]): number =>
      Math.min(...pts.filter((p) => Math.abs(p.x - 20) < 3 && p.y > 0).map((p) => p.y));
    expect(notchDepth(relaxRing(ring, 4, 10))).toBeGreaterThan(notchDepth(ring) + 3);
  });

  it("leaves a long straight edge straight", () => {
    const strip: Pt[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 20 },
      { x: 0, y: 20 },
    ];
    const middle = relaxRing(strip, 4, 10).filter((p) => p.x > 60 && p.x < 140 && p.y < 10);
    expect(middle.length).toBeGreaterThan(0);
    for (const p of middle) expect(Math.abs(p.y)).toBeLessThan(1e-9);
  });
});

describe("regionLabelAnchor", () => {
  it("centres a single disc with the disc's radius as inradius", () => {
    const region = countryRegions([system(1, 100, -50, 10)], PARAMS).get(10)!;
    const anchor = regionLabelAnchor(region)!;
    expect(anchor.x).toBeCloseTo(100, 0);
    expect(anchor.y).toBeCloseTo(-50, 0);
    expect(Math.abs(anchor.inradius - 35)).toBeLessThan(1);
    expect(anchor.extent).toBeCloseTo(Math.sqrt(Math.PI * 35 * 35), -1);
    expect(anchor.width).toBeGreaterThan(68);
    expect(anchor.width).toBeLessThan(72);
    expect(anchor.height).toBeGreaterThan(68);
    expect(anchor.height).toBeLessThan(72);
  });

  it("is null for an empty region", () => {
    expect(regionLabelAnchor([])).toBeNull();
  });

  it("spans a laned pair by the distance between them plus two radii", () => {
    const distance = 150;
    const region = countryRegions(
      [system(1, 0, 0, 10, [2]), system(2, distance, 0, 10, [1])],
      PARAMS,
    ).get(10)!;
    const anchor = regionLabelAnchor(region)!;
    expect(anchor.width).toBeGreaterThan(distance + 2 * PARAMS.radius - 2);
    expect(anchor.width).toBeLessThan(distance + 2 * PARAMS.radius + 2);
    expect(anchor.height).toBeGreaterThan(68);
    expect(anchor.height).toBeLessThan(72);
  });

  it("picks the largest polygon", () => {
    const region = countryRegions(
      [system(1, 0, 0, 10), system(2, 300, 0, 10, [3]), system(3, 340, 0, 10, [2])],
      PARAMS,
    ).get(10)!;
    expect(region).toHaveLength(2);
    const anchor = regionLabelAnchor(region)!;
    expect(anchor.x).toBeGreaterThan(265);
    expect(anchor.x).toBeLessThan(375);
    expect(Math.abs(anchor.inradius - 35)).toBeLessThan(1);
  });
});

describe("affectedCountries", () => {
  it("names the old and the new neighbours of a moved system", () => {
    const a = system(1, 0, 0, 10);
    const b = system(2, 300, 0, 20);
    const c = system(3, 600, 0, 30);
    const before = byId([a, b, c, system(4, 40, 0, 10)]);
    const after = byId([a, b, c, system(4, 260, 0, 10)]);
    expect(affectedCountries([after.get(4)!], before, after, PARAMS)).toEqual(new Set([10, 20]));
  });

  it("reaches a lane band the system sits beside", () => {
    const p = system(1, 0, 0, 20, [2]);
    const q = system(2, 200, 0, 20, [1]);
    const before = byId([p, q, system(3, 100, 400, 10)]);
    const after = byId([p, q, system(3, 100, 20, 10)]);
    expect(affectedCountries([after.get(3)!], before, after, PARAMS)).toEqual(new Set([10, 20]));
  });

  it("finds a neighbour a cell away and leaves the one just out of reach", () => {
    const near = system(2, 2 * PARAMS.radius - 1, 0, 20);
    const far = system(3, 2 * PARAMS.radius + 1, 0, 30);
    const before = byId([near, far, system(1, 0, -400, 10)]);
    const after = byId([near, far, system(1, 0, 0, 10)]);
    expect(affectedCountries([after.get(1)!], before, after, PARAMS)).toEqual(new Set([10, 20]));
  });

  it("reaches the middle of a long lane band from well outside either end's disc", () => {
    const p = system(1, 0, 0, 20, [2]);
    const q = system(2, 600, 0, 20, [1]);
    const before = byId([p, q, system(3, 300, 900, 10)]);
    const after = byId([p, q, system(3, 300, 100, 10)]);
    expect(affectedCountries([after.get(3)!], before, after, PARAMS)).toEqual(new Set([10, 20]));
  });

  it("is empty for an unowned system moving through empty space", () => {
    const before = byId([system(1, 0, 0, null)]);
    const after = byId([system(1, 500, 0, null)]);
    expect(affectedCountries([after.get(1)!], before, after, PARAMS).size).toBe(0);
  });
});
