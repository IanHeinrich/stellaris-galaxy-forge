import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { byId, placedNode } from "../../test/builders";
import { SAMPLE_CAP } from "../placement/limits";
import { buildGalaxy } from "../geometry/territory.fixture";
import { MESH_BETA } from "../geometry/mesh";
import type { Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { segmentsCross } from "../geometry/segments";
import type { Symmetry } from "../geometry/symmetry";
import { SCENARIO_HALF_EXTENT } from "../guides";
import { PlacementGround } from "../placement/ground";
import { laneSegments, provisionalId, provisionalIndex } from "../placement/lanes";
import { SpatialGrid } from "../spatialGrid";
import { shapePlacement } from "./placement";
import type { CircleShape, Fill, PendingShape, Shape, ShapeGround, ShapePreview } from "./types";

const OFF: Symmetry = { kind: "off" };

function groundOf(systems: SystemNode[], symmetry: Symmetry = OFF): ShapeGround {
  const grid = new SpatialGrid();
  grid.build(systems);
  return {
    placement: new PlacementGround(byId(...systems), grid, symmetry),
    extent: { shape: "square", half: SCENARIO_HALF_EXTENT },
    beta: MESH_BETA.gabriel,
  };
}

const EMPTY = groundOf([]);

function circle(over: Partial<CircleShape> = {}): CircleShape {
  return {
    kind: "circle",
    centre: { x: 0, y: 0 },
    radius: 200,
    rotation: 0,
    sweep: 360,
    squash: 100,
    ...over,
  };
}

function pending(shape: Shape, over: Partial<PendingShape> = {}): PendingShape {
  return {
    shape,
    fill: { kind: "outline", count: 24 },
    lanes: { follow: true, mode: "off" },
    skipNear: true,
    seed: 7,
    ...over,
  };
}

/** Where each end of the preview's lanes stands. */
function positions(preview: ShapePreview, systems: SystemNode[] = []): (id: number) => Pt {
  const byIds = byId(...systems);
  return (id) => (id < 0 ? preview.points[provisionalIndex(id)] : byIds.get(id)!);
}

/** How many pairs of lanes cross, among the preview's own and between them and the galaxy's. */
function crossings(preview: ShapePreview, systems: SystemNode[] = []): number {
  const at = positions(preview, systems);
  const existing = laneSegments(systems);
  const lanes = preview.pairs.map(([a, b]) => [at(a), at(b)]);
  let n = 0;
  lanes.forEach(([a, b], i) => {
    for (const { a: c, b: d } of existing) if (segmentsCross(a, b, c, d)) n++;
    for (const [c, d] of lanes.slice(i + 1)) if (segmentsCross(a, b, c, d)) n++;
  });
  return n;
}

const key = ([a, b]: Pair) => `${a},${b}`;

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

  it("keeps a filled disc on the pivot as one disc rather than four laid over each other", () => {
    const fill: Fill = { kind: "scattered", spacing: 20 };
    const alone = shapePlacement(pending(circle(), { fill }), EMPTY);
    const quarter = shapePlacement(
      pending(circle(), { fill }),
      groundOf([], { kind: "rotate", n: 4 }),
    );
    expect(quarter.overlaps).toBe(0);
    expect(quarter.points.length).toBeGreaterThan(alone.points.length * 0.6);
    expect(quarter.points.length).toBeLessThan(alone.points.length * 1.4);
    const hex: Fill = { kind: "grid", spacing: 20, lattice: "hex" };
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
        fill: { kind: "scattered", spacing: 25 },
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
    const fill: Fill = { kind: "scattered", spacing: 15 };
    const small = shapePlacement(pending(circle({ radius: 120 }), { fill }), EMPTY);
    const large = shapePlacement(pending(circle({ radius: 240 }), { fill }), EMPTY);
    const inner = small.points.filter((p) => Math.hypot(p.x, p.y) < 120 - 15);
    const kept = new Set(large.points.map((p) => `${p.x},${p.y}`));
    expect(inner.length).toBeGreaterThan(50);
    expect(inner.filter((p) => !kept.has(`${p.x},${p.y}`))).toEqual([]);
    const reseeded = shapePlacement(pending(circle({ radius: 120 }), { fill, seed: 8 }), EMPTY);
    expect(reseeded.points).not.toEqual(small.points);
  });

  it("places about a thousand systems with lanes within budget", () => {
    const systems = [...galaxy];
    const shape = circle({ radius: 340 });
    const fill: Fill = { kind: "scattered", spacing: 15 };
    const lanes = { follow: true, mode: "new" } as const;
    const ground = groundOf(systems);
    shapePlacement(pending(shape, { fill, lanes, skipNear: false }), ground);
    const start = performance.now();
    const preview = shapePlacement(pending(shape, { fill, lanes, skipNear: false }), ground);
    const elapsed = performance.now() - start;
    expect(preview.points.length).toBeGreaterThan(900);
    // Generous so a slow CI runner does not fail it; locally it takes a fraction of this.
    expect(elapsed).toBeLessThan(500);
  });
});
