import { describe, expect, it } from "vitest";
import { placedNode } from "../../test/builders";
import { pairOf, type Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { provisionalId, provisionalIndex } from "../placement/lanes";
import { NO_EXTRAS } from "./extras";
import { shapePlacement } from "./placement";
import { EMPTY, circle, crossings, groundOf, key, pending } from "./placement.fixture";
import { SHAPE_SPECS } from "./specs";

describe("the outline's extras", () => {
  const spokes = { ...NO_EXTRAS, centre: "spokes" } as const;
  const twelve = { kind: "outline", count: 12 } as const;
  const touches = (id: number) => (pair: Pair) => pair[0] === id || pair[1] === id;

  it("joins each arm of a spiral along itself, never one arm to the next", () => {
    const spiral = { ...SHAPE_SPECS.spiral.initial, arms: 3 };
    const preview = shapePlacement(
      pending(spiral, { fill: { kind: "outline", count: 30 } }),
      EMPTY,
    );
    expect(preview.points).toHaveLength(30);
    expect(preview.pairs).toHaveLength(27);
    for (const end of [9, 19]) {
      const across = pairOf(provisionalId(end), provisionalId(end + 1));
      expect(preview.pairs.map(key)).not.toContain(key(across));
    }
    expect(crossings(preview)).toBe(0);
  });

  it("opens exactly the gaps asked for, spread evenly, and the mesh bridges none", () => {
    const gapped = pending(circle(), { extras: { ...NO_EXTRAS, gaps: 3 } });
    const preview = shapePlacement(gapped, EMPTY);
    expect(preview.points).toHaveLength(24);
    expect(preview.pairs).toHaveLength(21);
    const joined = new Set(preview.pairs.map(key));
    const open = Array.from({ length: 24 }, (_, i) => i).filter(
      (i) => !joined.has(key(pairOf(provisionalId(i), provisionalId((i + 1) % 24)))),
    );
    expect(open).toEqual([0, 8, 16]);
    const meshed = shapePlacement(
      { ...gapped, lanes: { follow: true, mode: "new" } },
      { ...EMPTY, laneDensity: 1 },
    );
    expect(meshed.pairs.map(key).sort()).toEqual(preview.pairs.map(key).sort());
  });

  it("copies the gaps with the shape under symmetry, so a count the copies divide keeps them", () => {
    const quarter = groundOf([], { kind: "rotate", n: 4 });
    const gapped = pending(circle(), { extras: { ...NO_EXTRAS, gaps: 4 } });
    const preview = shapePlacement(gapped, quarter);
    expect(preview.points).toHaveLength(24);
    expect(preview.pairs).toHaveLength(20);
  });

  it("lays concentric rings, each joined round itself and none crossing", () => {
    const rings = pending(circle(), { extras: { ...NO_EXTRAS, rings: 3 } });
    const onion = shapePlacement(rings, EMPTY);
    expect(onion.points).toHaveLength(24 + 18 + 11);
    expect(onion.pairs).toHaveLength(24 + 18 + 11);
    expect(crossings(onion)).toBe(0);
  });

  it("leaves a hollow centre empty, and lines the hole's edge as well as the outside", () => {
    const fill = { kind: "scattered", spacing: 20, edge: true } as const;
    const lanes = { follow: true, mode: "new" } as const;
    const r = (p: Pt) => Math.hypot(p.x, p.y);
    const donut = shapePlacement(pending(circle({ hollow: 50 }), { fill, lanes }), EMPTY);
    expect(Math.min(...donut.points.map(r))).toBeGreaterThan(99.99);
    expect(donut.points.filter((p) => Math.abs(r(p) - 100) < 0.01).length).toBeGreaterThan(10);
    expect(crossings(donut)).toBe(0);
    const disc = shapePlacement(pending(circle(), { fill, lanes }), EMPTY);
    expect(disc.points.some((p) => r(p) < 90)).toBe(true);
  });

  it("puts a system at the centre with a spoke to every point, crossing nothing, under four-fold rotation too", () => {
    const wheel = pending(circle(), { fill: twelve, extras: spokes });
    const alone = shapePlacement(wheel, EMPTY);
    expect(alone.points).toHaveLength(13);
    expect(alone.points[12]).toEqual({ x: 0, y: 0 });
    expect(alone.pairs).toHaveLength(24);
    expect(alone.pairs.filter(touches(provisionalId(12)))).toHaveLength(12);
    expect(crossings(alone)).toBe(0);

    const quarter = groundOf([], { kind: "rotate", n: 4 });
    const merged = shapePlacement(wheel, quarter);
    expect(merged.points).toHaveLength(13);
    expect(merged.pairs).toHaveLength(24);
    expect(crossings(merged)).toBe(0);

    const apart = pending(circle({ centre: { x: 250, y: 0 }, radius: 80 }), {
      fill: twelve,
      extras: spokes,
    });
    const four = shapePlacement(apart, quarter);
    expect(four.points).toHaveLength(52);
    expect(four.pairs).toHaveLength(96);
    expect(crossings(four)).toBe(0);
  });

  it("runs the spokes to a home system the centre point is left out for", () => {
    const home = placedNode(1, 0, 0);
    const preview = shapePlacement(
      pending(circle(), { fill: twelve, extras: spokes }),
      groundOf([home]),
    );
    expect(preview.points).toHaveLength(12);
    expect(preview.left.map((l) => l.blocker)).toEqual([1]);
    expect(preview.pairs.filter(touches(1))).toHaveLength(12);
  });

  it("thickens a wobbled spiral into a band whose lanes cross nothing", () => {
    const preview = shapePlacement(
      pending(
        { ...SHAPE_SPECS.spiral.initial, inner: 50 },
        {
          fill: { kind: "outline", count: 40 },
          lanes: { follow: true, mode: "new" },
          extras: { ...NO_EXTRAS, band: 3, wobble: 50, gaps: 2 },
        },
      ),
      EMPTY,
    );
    // Each arm's shifted strand stops half a step short of the arm's end.
    expect(preview.points).toHaveLength(118);
    expect(crossings(preview)).toBe(0);
  });

  it("wobbles a grid inside the shape, the same for the same seed", () => {
    const fill = { kind: "grid", spacing: 25, lattice: "square" } as const;
    const lanes = { follow: false, mode: "off" } as const;
    const plain = shapePlacement(pending(circle(), { fill, lanes }), EMPTY);
    const shaken = pending(circle(), { fill, lanes, extras: { ...NO_EXTRAS, wobble: 60 } });
    const wobbled = shapePlacement(shaken, EMPTY);
    expect(wobbled.points.length).toBeGreaterThan(0.9 * plain.points.length);
    expect(wobbled.points.every((p) => Math.hypot(p.x, p.y) <= 200)).toBe(true);
    expect(wobbled.points).not.toEqual(plain.points);
    expect(shapePlacement(shaken, EMPTY).points).toEqual(wobbled.points);
  });
});

describe("gaps across a band", () => {
  it("splits a band in as many parts as it has gaps, the mesh between its strands too", () => {
    const preview = shapePlacement(
      pending(circle(), {
        lanes: { follow: true, mode: "new" },
        extras: { ...NO_EXTRAS, band: 3, gaps: 2 },
      }),
      { ...EMPTY, laneDensity: 1 },
    );
    expect(preview.points).toHaveLength(72);
    const parent = preview.points.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (const [a, b] of preview.pairs) {
      parent[root(provisionalIndex(a))] = root(provisionalIndex(b));
    }
    const parts = new Set(preview.points.map((_, i) => root(i)));
    expect(parts.size).toBe(2);
  });

  it("splits a donut's edge rows into whole multiples of symmetry's copies", () => {
    const donut = circle({ hollow: 50 });
    const { runs } = SHAPE_SPECS.circle.edge(donut, 60, 4);
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(run.count % 4).toBe(0);
    expect(runs[0].count + runs[1].count).toBe(60);
  });
});
