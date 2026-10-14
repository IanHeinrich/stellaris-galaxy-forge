import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { placedNode } from "../../test/builders";
import { buildGalaxy } from "../geometry/territory.fixture";
import { DEFAULT_LANE_DENSITY } from "../geometry/mesh";
import { pairOf } from "../geometry/pairs";
import { asWritten, dist2, type Pt, WRITTEN_DRIFT, writtenPt } from "../geometry/pt";
import type { Symmetry } from "../geometry/symmetry";
import { SCENARIO_HALF_EXTENT } from "../guides";
import { provisionalId } from "../placement/lanes";
import { LEAST_SPACING, SAMPLE_CAP } from "../placement/limits";
import { fillSpacing, leastSpacing, shapePlacement } from "./placement";
import {
  components,
  crossings,
  EMPTY,
  OFF,
  ROLLED,
  STATEMENTS,
  circle,
  groundOf,
  key,
  pending,
  positions,
} from "./placement.fixture";
import { SHAPE_SPECS } from "./specs";
import type { Fill, PolygonShape, ShapeGround, ShapePreview, SpacedFill } from "./types";

describe("an outline's points and follow lanes", () => {
  it("joins a closed ring's n points with n lanes, the last back to the first", () => {
    const preview = shapePlacement(pending(circle()), EMPTY);
    expect(preview.points).toHaveLength(24);
    expect(preview.pairs).toHaveLength(24);
    expect(preview.pairs).toContainEqual([provisionalId(23), provisionalId(0)]);
    expect(preview).toMatchObject({ left: [], outside: [], overlaps: 0, capped: false });
  });

  it("joins a line's n points with n - 1 lanes, and an arc's the same", () => {
    const line = shapePlacement(
      pending(
        { kind: "line", a: { x: -100, y: 0 }, b: { x: 100, y: 0 } },
        { fill: { kind: "outline", count: 5 } },
      ),
      EMPTY,
    );
    expect(line.points).toEqual([-100, -50, 0, 50, 100].map((x) => ({ x, y: 0 })));
    expect(line.pairs).toHaveLength(4);
    const arc = shapePlacement(
      pending(circle({ sweep: 180 }), { fill: { kind: "outline", count: 7 } }),
      EMPTY,
    );
    expect(arc.pairs).toHaveLength(6);
  });

  it("leaves out a point beside a system and runs the lanes through that system instead", () => {
    // Point 6 of a ring of 24 at radius 200 sits at (0, 200).
    const blocker = placedNode(9, 3, 198);
    const preview = shapePlacement(pending(circle()), groundOf([blocker]));
    expect(preview.points).toHaveLength(23);
    expect(preview.left).toEqual([
      { at: expect.objectContaining({ x: expect.closeTo(0), y: 200 }), blocker: 9 },
    ]);
    // Points 5 and 7 are new points 5 and 6 once point 6 is left out.
    expect(preview.pairs).toContainEqual([provisionalId(5), 9]);
    expect(preview.pairs).toContainEqual([provisionalId(6), 9]);
    expect(preview.pairs).toHaveLength(24);

    const regardless = shapePlacement(pending(circle(), { skipNear: false }), groundOf([blocker]));
    expect(regardless.points).toHaveLength(24);
    expect(regardless.left).toEqual([]);
    expect(regardless.overlaps).toBe(1);
  });

  it("leaves points past the edge out with no lanes", () => {
    const preview = shapePlacement(
      pending(circle({ centre: { x: 450, y: 0 }, radius: 100 })),
      EMPTY,
    );
    expect(preview.outside.length).toBeGreaterThan(0);
    expect(preview.outside.every((p) => p.x > SCENARIO_HALF_EXTENT)).toBe(true);
    expect(preview.points.length + preview.outside.length).toBe(24);
    // The ring is broken where it leaves the map: one lane fewer than points.
    expect(preview.pairs).toHaveLength(preview.points.length - 1);
  });

  it("caps the points at the sample cap over the symmetry's copies", () => {
    const many: Fill = { kind: "outline", count: 2000 };
    const alone = shapePlacement(pending(circle({ radius: 400 }), { fill: many }), EMPTY);
    expect(alone.points).toHaveLength(SAMPLE_CAP);
    expect(alone.capped).toBe(true);
    const mirrored = shapePlacement(
      pending(circle({ centre: { x: 0, y: 250 }, radius: 200 }), { fill: many }),
      groundOf([], { kind: "mirror", axis: "x" }),
    );
    expect(mirrored.points).toHaveLength(SAMPLE_CAP);
    expect(mirrored.capped).toBe(true);
  });

  it("keeps a sparse triangle's corners when systems stand a little way off them", () => {
    const triangle: PolygonShape = {
      kind: "polygon",
      centre: { x: 0, y: 0 },
      radius: 400,
      rotation: 90,
      sides: 3,
      hollow: 0,
    };
    const corners = SHAPE_SPECS.polygon.outline(triangle, 3).points;
    const systems = corners.map((c, i) => placedNode(i + 1, c.x + 100, c.y));
    const preview = shapePlacement(
      pending(triangle, { fill: { kind: "outline", count: 3 } }),
      groundOf(systems),
    );
    expect(preview.left).toEqual([]);
    expect(preview.points).toHaveLength(3);
  });

  it("leaves out only the outline points that sit on top of a system", () => {
    const ring = circle();
    const points = SHAPE_SPECS.circle.outline(ring, 24).points;
    const systems = [
      placedNode(1, points[0].x + 15, points[0].y),
      placedNode(2, points[5].x + 6, points[5].y),
    ];
    const preview = shapePlacement(pending(ring), groundOf(systems));
    expect(preview.left.map((l) => l.blocker)).toEqual([2]);
    expect(preview.points).toHaveLength(23);
  });
});

describe("following the shape", () => {
  const star = { ...SHAPE_SPECS.star.initial, radius: 150 };
  const outline: Fill = { kind: "outline", count: 30 };
  const dense = (symmetry: Symmetry = OFF): ShapeGround => ({
    ...groundOf([], symmetry),
    laneDensity: 1,
  });
  /** The lanes joining each point of a ring of `n` to the next, starting at new point `from`. */
  const ring = (n: number, from = 0): string[] =>
    Array.from({ length: n }, (_, i) =>
      key(pairOf(provisionalId(from + i), provisionalId(from + ((i + 1) % n)))),
    );

  it("joins a star's outline only point to point at the highest Lane density", () => {
    const preview = shapePlacement(
      pending(star, { fill: outline, lanes: { follow: true, mode: "new" } }),
      dense(),
    );
    expect(preview.points).toHaveLength(30);
    expect(new Set(preview.pairs.map(key))).toEqual(new Set(ring(30)));
  });

  it("lets the mesh join a star's outline across its corners without Follow", () => {
    const preview = shapePlacement(
      pending(star, { fill: outline, lanes: { follow: false, mode: "new" } }),
      dense(),
    );
    expect(preview.pairs.length).toBeGreaterThan(30);
  });

  it.each([0, DEFAULT_LANE_DENSITY, 1])(
    "still joins a filled circle's systems to its edge at Lane density %s",
    (laneDensity) => {
      const preview = shapePlacement(
        pending(circle(), {
          fill: { kind: "scattered", spacing: 25, edge: true },
          lanes: { follow: true, mode: "new" },
        }),
        { ...dense(), laneDensity },
      );
      expect(preview.points.length).toBeGreaterThan(100);
      expect(components(preview)).toBe(1);
    },
  );

  it("keeps every copy's outline to point-to-point lanes under symmetry", () => {
    const off = { ...star, centre: { x: 250, y: 0 }, radius: 100 };
    const preview = shapePlacement(
      pending(off, { fill: outline, lanes: { follow: true, mode: "new" } }),
      dense({ kind: "rotate", n: 3 }),
    );
    expect(preview.points).toHaveLength(90);
    expect(new Set(preview.pairs.map(key))).toEqual(
      new Set([...ring(30), ...ring(30, 30), ...ring(30, 60)]),
    );
  });
});

describe("a shape under symmetry", () => {
  it("merges a ring on the pivot into itself when the copies divide its count", () => {
    const quarter = groundOf([], { kind: "rotate", n: 4 });
    const even = shapePlacement(pending(circle()), quarter);
    expect(even.points).toHaveLength(24);
    expect(even.pairs).toHaveLength(24);
    expect(even.interleaved).toBeNull();

    const odd = shapePlacement(
      pending(circle(), { fill: { kind: "outline", count: 21 } }),
      quarter,
    );
    expect(odd.points).toHaveLength(84);
    expect(odd.interleaved).toBe(4);
  });

  it("places a ring off the mirror axis twice, each copy with its own lanes", () => {
    const off = circle({ centre: { x: 100, y: 200 }, radius: 80 });
    const preview = shapePlacement(pending(off), groundOf([], { kind: "mirror", axis: "x" }));
    expect(preview.points).toHaveLength(48);
    expect(preview.pairs).toHaveLength(48);
    expect(preview.points.slice(24).every((p) => p.y < 0)).toBe(true);
    expect(preview.interleaved).toBeNull();
  });

  it("gives a mirrored ring that overlaps its own image mirror-symmetric follow lanes", () => {
    const ring = circle({ centre: { x: 100, y: 30 }, radius: 80 });
    const preview = shapePlacement(pending(ring), groundOf([], { kind: "mirror", axis: "x" }));
    const at = positions(preview);
    const spot = (p: Pt) => `${Math.round(p.x * 1e3) / 1e3 + 0},${Math.round(p.y * 1e3) / 1e3 + 0}`;
    const lane = (p: Pt, q: Pt) => [spot(p), spot(q)].sort().join(" ");
    const flip = (p: Pt) => ({ x: p.x, y: -p.y });
    const lanes = preview.pairs.map(([a, b]) => lane(at(a), at(b)));
    const flipped = preview.pairs.map(([a, b]) => lane(flip(at(a)), flip(at(b))));
    expect(new Set(flipped)).toEqual(new Set(lanes));
    expect(lanes.length).toBeGreaterThan(24);
    expect(crossings(preview)).toBe(0);
  });

  it("keeps a filled disc on the pivot as one disc rather than four laid over each other", () => {
    const fill: Fill = { kind: "scattered", spacing: 20, edge: true };
    const alone = shapePlacement(pending(circle(), { fill }), EMPTY);
    const quarter = shapePlacement(
      pending(circle(), { fill }),
      groundOf([], { kind: "rotate", n: 4 }),
    );
    expect(quarter.overlaps).toBe(0);
    expect(quarter.points.length).toBeGreaterThan(alone.points.length * 0.6);
    expect(quarter.points.length).toBeLessThan(alone.points.length * 1.4);
    const hex: Fill = { kind: "grid", spacing: 40, lattice: "hex" };
    const lattice = shapePlacement(
      pending(circle(), { fill: hex }),
      groundOf([], { kind: "rotate", n: 6 }),
    );
    expect(lattice.points).toHaveLength(
      shapePlacement(pending(circle(), { fill: hex }), EMPTY).points.length,
    );
    expect(lattice.overlaps).toBe(0);
  });
});

describe("a filled shape", () => {
  const galaxy = buildGalaxy().systems.filter((s) => s.x < 0 && Math.hypot(s.x, s.y) < 480);

  it("meshes inside its follow lanes with no lane crossing another or an existing lane, each once", () => {
    const systems = [...galaxy];
    const preview = shapePlacement(
      pending(circle({ centre: { x: 60, y: -40 }, radius: 220 }), {
        fill: { kind: "scattered", spacing: 25, edge: true },
        lanes: { follow: true, mode: "nearby" },
      }),
      groundOf(systems),
    );
    expect(preview.points.length).toBeGreaterThan(50);
    expect(preview.left.length).toBeGreaterThan(0);
    expect(crossings(preview, systems)).toBe(0);
    expect(new Set(preview.pairs.map(key)).size).toBe(preview.pairs.length);
  });

  it("keeps every point of a smaller scattered fill when it grows, under the same seed", () => {
    const fill: Fill = { kind: "scattered", spacing: 15, edge: true };
    const small = shapePlacement(pending(circle({ radius: 120 }), { fill }), EMPTY);
    const large = shapePlacement(pending(circle({ radius: 240 }), { fill }), EMPTY);
    const inner = small.points.filter((p) => Math.hypot(p.x, p.y) < 120 - 15);
    const kept = new Set(large.points.map((p) => `${p.x},${p.y}`));
    expect(inner.length).toBeGreaterThan(50);
    expect(inner.filter((p) => !kept.has(`${p.x},${p.y}`))).toEqual([]);
    const reseeded = shapePlacement(pending(circle({ radius: 120 }), { fill, seed: 8 }), EMPTY);
    expect(reseeded.points).not.toEqual(small.points);
  });

  it("places the most systems a fill takes, with lanes, within budget", () => {
    const systems = [...galaxy];
    const shape = circle({ radius: 340 });
    const fill: Fill = { kind: "scattered", spacing: 15, edge: true };
    const lanes = { follow: true, mode: "new" } as const;
    const ground = groundOf(systems);
    shapePlacement(pending(shape, { fill, lanes, skipNear: false }), ground);
    const start = performance.now();
    const preview = shapePlacement(pending(shape, { fill, lanes, skipNear: false }), ground);
    const elapsed = performance.now() - start;
    expect(preview.points.length).toBeGreaterThan(800);
    // Generous so a slow CI runner does not fail it; locally it takes a fraction of this.
    expect(elapsed).toBeLessThan(500);
  });
});

/** The share of `points` per unit of area between `inner` and `outer` from the origin. */
function densityBetween(points: readonly Pt[], inner: number, outer: number): number {
  const n = points.filter((p) => {
    const d = Math.hypot(p.x, p.y);
    return d >= inner && d < outer;
  }).length;
  return n / (Math.PI * (outer * outer - inner * inner));
}

const onRim = (p: Pt, r: number) => Math.abs(Math.hypot(p.x, p.y) - r) < WRITTEN_DRIFT;

describe("a scattered fill's edge row", () => {
  const disc = circle({ radius: 300 });
  const lanes = { follow: false, mode: "new" } as const;
  const lined = shapePlacement(
    pending(disc, { fill: { kind: "scattered", spacing: 25, edge: true }, lanes }),
    EMPTY,
  );
  const bare = shapePlacement(
    pending(disc, { fill: { kind: "scattered", spacing: 25, edge: false }, lanes }),
    EMPTY,
  );

  it("lines the outline with systems, and leaves none on it without", () => {
    expect(lined.points.filter((p) => onRim(p, 300)).length).toBeGreaterThan(60);
    expect(bare.points.filter((p) => onRim(p, 300))).toEqual([]);
    expect(bare.points.length).toBeGreaterThan(150);
  });

  it("leaves out the ring of lanes round the outside without the row", () => {
    const rimLanes = (preview: ShapePreview) => {
      const at = positions(preview);
      return preview.pairs.filter(([a, b]) => onRim(at(a), 300) && onRim(at(b), 300)).length;
    };
    expect(rimLanes(lined)).toBeGreaterThan(60);
    const outer = (preview: ShapePreview) => {
      const at = positions(preview);
      return preview.pairs.filter(([a, b]) =>
        [at(a), at(b)].every((p) => Math.hypot(p.x, p.y) > 300 - 25),
      ).length;
    };
    expect(outer(bare)).toBeLessThan(rimLanes(lined) / 2);
  });
});

describe("a filled arc", () => {
  const half = circle({ radius: 250, rotation: 90, sweep: 180 });

  it("fills the half disc of a semicircle and nothing outside it", () => {
    const preview = shapePlacement(
      pending(half, { fill: { kind: "scattered", spacing: 20, edge: true } }),
      EMPTY,
    );
    expect(preview.points.length).toBeGreaterThan(150);
    for (const p of preview.points) {
      expect(p.x).toBeLessThanOrEqual(1e-6);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(250 + 1e-6);
    }
    expect(preview.points.some((p) => p.x < -200)).toBe(true);
  });

  it("runs its edge row along the arc and both sides, with a point on the centre and each end", () => {
    const { points, runs } = SHAPE_SPECS.circle.edge(half, 40);
    expect(runs).toEqual([{ start: 0, count: 40, closed: true }]);
    expect(points).toHaveLength(40);
    const has = (q: Pt) => points.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
    expect(has({ x: 0, y: 0 })).toBe(true);
    expect(has({ x: 0, y: 250 })).toBe(true);
    expect(has({ x: 0, y: -250 })).toBe(true);
  });
});

describe("the closest spacing a fill takes", () => {
  const disc = circle({ radius: 500 });
  const fills: Fill[] = [
    { kind: "scattered", spacing: 5, edge: true },
    { kind: "grid", spacing: 5, lattice: "square" },
    { kind: "grid", spacing: 5, lattice: "hex" },
  ];

  it.each(fills)(
    "fills the whole of a large circle at it, with no gap before the edge: %o",
    (fill) => {
      const preview = shapePlacement(
        pending(disc, { fill, lanes: { follow: false, mode: "off" } }),
        EMPTY,
      );
      const used = fillSpacing(disc, fill as SpacedFill, OFF, STATEMENTS);
      expect(used).toBeGreaterThan(5);
      expect(preview.capped).toBe(false);
      const middle = densityBetween(preview.points, 0, 250);
      const band = densityBetween(preview.points, 0.85 * 500, 500 - used);
      expect(band).toBeGreaterThan(0.8 * middle);
    },
  );

  it("grows as the shape grows, from the least spacing for a small shape", () => {
    const fill: SpacedFill = { kind: "scattered", spacing: 5, edge: true };
    const at = (radius: number) => leastSpacing(circle({ radius }), fill, OFF, STATEMENTS);
    expect(at(40)).toBe(LEAST_SPACING);
    expect(at(250)).toBeGreaterThan(LEAST_SPACING);
    expect(at(500)).toBeGreaterThan(at(250));
  });

  it("holds each copy of a disc off the pivot to a quarter of the cap under four-fold rotation", () => {
    const fill: SpacedFill = { kind: "grid", spacing: 5, lattice: "square" };
    const off = circle({ centre: { x: 250, y: 0 }, radius: 150 });
    const quarter = groundOf([], { kind: "rotate", n: 4 });
    // A quarter of the cap over the disc's area and edge: area / d² + edge / d = cap / 4.
    const area = Math.PI * 150 * 150;
    const edge = 2 * Math.PI * 150;
    const perCopy = (2 * area) / (Math.sqrt(edge * edge + area * SAMPLE_CAP) - edge);
    expect(leastSpacing(off, fill, quarter.placement.symmetry, STATEMENTS) / perCopy).toBeCloseTo(
      1,
      1,
    );
    const preview = shapePlacement(pending(off, { fill }), quarter);
    expect(preview.capped).toBe(false);
    expect(preview.points.length).toBeLessThanOrEqual(SAMPLE_CAP);
    expect(preview.points.length).toBeGreaterThan(SAMPLE_CAP * 0.6);
  });

  it("gives a disc on the pivot about its own spacing under symmetry, as its copies merge", () => {
    const disc = circle({ radius: 200 });
    const quarter = groundOf([], { kind: "rotate", n: 4 });
    for (const fill of [
      { kind: "scattered", spacing: 5, edge: true },
      { kind: "grid", spacing: 5, lattice: "hex" },
    ] as const) {
      const alone = leastSpacing(disc, fill, OFF, STATEMENTS);
      const merged = leastSpacing(disc, fill, quarter.placement.symmetry, STATEMENTS);
      expect(Math.abs(merged / alone - 1)).toBeLessThan(0.1);
      const preview = shapePlacement(pending(disc, { fill }), quarter);
      expect(preview.capped).toBe(false);
      expect(preview.points.length).toBeGreaterThan(SAMPLE_CAP * 0.6);
    }
  });

  it("measures the area a shape's copies cover quickly enough for the live preview", () => {
    const star = { ...SHAPE_SPECS.star.initial, centre: { x: 120, y: 40 }, points: 12 };
    const fill: SpacedFill = { kind: "scattered", spacing: 5, edge: true };
    const sym = { kind: "rotate", n: 8 } as const;
    leastSpacing(star, fill, sym, STATEMENTS);
    const start = performance.now();
    for (let i = 0; i < 10; i++) leastSpacing(star, fill, sym, STATEMENTS);
    // Generous so a slow CI runner does not fail it; locally one call takes a few milliseconds.
    expect((performance.now() - start) / 10).toBeLessThan(50);
  });
});

describe("a shape rolled into a save", () => {
  const minGap = ROLLED.minGap;

  /** The least distance between any two of `points`. */
  function closest(points: readonly Pt[]): number {
    let least = Infinity;
    points.forEach((p, i) => {
      for (const q of points.slice(i + 1)) least = Math.min(least, Math.sqrt(dist2(p, q)));
    });
    return least;
  }

  it("leaves out a point within the spawn buffer of a system even with Skip near off", () => {
    // Point 6 of a ring of 24 at radius 200 sits at (0, 200).
    const blocker = placedNode(9, 0, 200 - minGap + 1);
    const preview = shapePlacement(
      pending(circle(), { skipNear: false }),
      groundOf([blocker], OFF, ROLLED),
    );
    expect(preview.left.map((l) => l.blocker)).toEqual([9]);
    expect(preview.points).toHaveLength(23);
  });

  it("drops an outline's points that crowd within the spawn buffer of each other, and counts them", () => {
    const dense = shapePlacement(
      pending(circle({ radius: 100 }), { fill: { kind: "outline", count: 200 } }),
      groundOf([], OFF, ROLLED),
    );
    expect(dense.crowded).toBeGreaterThan(0);
    expect(dense.points.length + dense.crowded).toBe(200);
    expect(closest(dense.points)).toBeGreaterThanOrEqual(minGap - 1e-6);
    const loose = shapePlacement(pending(circle({ radius: 100 })), groundOf([], OFF, ROLLED));
    expect(loose.crowded).toBe(0);
    expect(loose.points).toHaveLength(24);
  });

  it("stops at the save's cap", () => {
    const preview = shapePlacement(
      pending(circle({ radius: 400 }), { fill: { kind: "outline", count: 240 } }),
      groundOf([], OFF, ROLLED),
    );
    expect(preview.points).toHaveLength(ROLLED.cap);
    expect(ROLLED.cap).toBe(200);
    expect(preview.capped).toBe(true);
  });

  it("never fills closer than the spawn buffer", () => {
    const small = circle({ radius: 60 });
    for (const fill of [
      { kind: "scattered", spacing: 5, edge: true },
      { kind: "grid", spacing: 5, lattice: "square" },
      { kind: "grid", spacing: 5, lattice: "hex" },
    ] as const) {
      expect(fillSpacing(small, fill, OFF, ROLLED)).toBeGreaterThanOrEqual(minGap);
      const preview = shapePlacement(pending(small, { fill }), groundOf([], OFF, ROLLED));
      expect(preview.points.length).toBeGreaterThan(10);
      expect(closest(preview.points)).toBeGreaterThanOrEqual(minGap - 1e-6);
    }
  });

  it("gives each point a star class from the ground's weights, and none without them", () => {
    const ground = {
      ...groundOf([], OFF, ROLLED),
      starWeights: [["sc_g", 1]] as Array<[string, number]>,
    };
    const preview = shapePlacement(pending(circle()), ground);
    expect(preview.classes).toEqual(preview.points.map(() => "sc_g"));
    expect(shapePlacement(pending(circle()), groundOf([])).classes).toBeNull();
  });

  /** The least distance between any two of `points`, as the core measures it. */
  function closestHypot(points: readonly Pt[]): number {
    let least = Infinity;
    points.forEach((p, i) => {
      for (const q of points.slice(i + 1))
        least = Math.min(least, Math.hypot(p.x - q.x, p.y - q.y));
    });
    return least;
  }

  it("fills a lattice at a spacing of exactly the spawn buffer off a whole-number centre in full, every point as written", () => {
    const off = circle({ centre: { x: 3.3, y: 7.7 }, radius: 60 });
    for (const lattice of ["square", "hex"] as const) {
      const fill = { kind: "grid", spacing: minGap, lattice } as const;
      const preview = shapePlacement(pending(off, { fill }), groundOf([], OFF, ROLLED));
      expect(preview.points.length).toBeGreaterThan(100);
      expect(preview.points.map(writtenPt)).toEqual(preview.points);
      expect(closestHypot(preview.points)).toBeGreaterThanOrEqual(minGap);
    }
  });

  it("places no point on a circle the galaxy's size that is outside the galaxy once written", () => {
    const rim = circle({ radius: 500 });
    const preview = shapePlacement(
      pending(rim, { fill: { kind: "outline", count: 200 } }),
      groundOf([], OFF, ROLLED),
    );
    expect(preview.points.length).toBeGreaterThan(0);
    for (const p of preview.points) {
      expect(Math.hypot(asWritten(p.x), asWritten(p.y))).toBeLessThanOrEqual(500);
    }
  });

  it("keeps the other points' star classes when a system leaves one out", () => {
    const weights: Array<[string, number]> = [
      ["sc_g", 1],
      ["sc_m", 1],
      ["sc_k", 1],
    ];
    const classesAt = (systems: SystemNode[]) => {
      const preview = shapePlacement(pending(circle()), {
        ...groundOf(systems, OFF, ROLLED),
        starWeights: weights,
      });
      return new Map(preview.points.map((p, i) => [`${p.x},${p.y}`, preview.classes![i]]));
    };
    const open = classesAt([]);
    // Point 6 of a ring of 24 at radius 200 sits at (0, 200).
    const blocked = classesAt([placedNode(9, 0, 200 - minGap + 1)]);
    expect(blocked.size).toBe(23);
    expect(new Set(open.values()).size).toBeGreaterThan(1);
    for (const [at, cls] of blocked) expect(cls).toBe(open.get(at));
  });
});
