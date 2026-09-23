import { describe, expect, it } from "vitest";
import { lanesTo, systemNode } from "../../test/builders";
import { segmentsCross } from "../geometry/segments";
import { MESH_BETA, type MeshPoint } from "../geometry/mesh";
import type { Pair } from "../geometry/pairs";
import { laneSegments, meshWithin, strokeLanes, withProvisionalIds } from "./lanes";

const SPACING = 10;
const MAX = 3 * SPACING;

/** A 5x5 grid of new points 10 apart, around the origin. */
const ADDED = withProvisionalIds(
  Array.from({ length: 25 }, (_, k) => ({ x: (k % 5) * 10 - 20, y: Math.floor(k / 5) * 10 - 20 })),
);

/** Existing systems ringing the grid, with one lane cutting across its top-left corner. */
const SYSTEMS = [
  systemNode({ id: 1, x: -35, y: 0, lanes: lanesTo(2) }),
  systemNode({ id: 2, x: 0, y: -35, lanes: lanesTo(1) }),
  systemNode({ id: 3, x: 35, y: 0 }),
  systemNode({ id: 4, x: 0, y: 35 }),
  systemNode({ id: 5, x: 300, y: 300 }),
];
const NEARBY: MeshPoint[] = SYSTEMS.slice(0, 4).map(({ id, x, y }) => ({ id, x, y }));
const EXISTING = laneSegments(SYSTEMS);

function positions(points: readonly MeshPoint[]): Map<number, MeshPoint> {
  return new Map(points.map((p) => [p.id, p]));
}

function crossings(pairs: readonly Pair[], at: Map<number, MeshPoint>): number {
  let n = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i].map((id) => at.get(id)!);
    for (const [c, d] of EXISTING) if (segmentsCross(a, b, c, d)) n++;
    for (let j = i + 1; j < pairs.length; j++) {
      const [c, d] = pairs[j].map((id) => at.get(id)!);
      if (segmentsCross(a, b, c, d)) n++;
    }
  }
  return n;
}

describe("laneSegments", () => {
  it("lists each lane once and skips lanes to absent systems", () => {
    expect(laneSegments(SYSTEMS).map(([a, b]) => [a.id, b.id])).toEqual([[1, 2]]);
    expect(laneSegments(SYSTEMS.slice(1))).toEqual([]);
  });
});

describe("strokeLanes", () => {
  const base = {
    added: ADDED,
    nearby: NEARBY,
    existing: EXISTING,
    beta: MESH_BETA.gabriel,
    maxLength: MAX,
  };

  it("adds nothing when off", () => {
    expect(strokeLanes({ ...base, mode: "off" })).toEqual([]);
  });

  it("in 'new' mode links only new points, crossing no existing lane and no other new lane", () => {
    const pairs = strokeLanes({ ...base, mode: "new" });
    expect(pairs.length).toBeGreaterThan(20);
    expect(pairs.every(([a, b]) => a < 0 && b < 0)).toBe(true);
    expect(crossings(pairs, positions(ADDED))).toBe(0);
    // The existing lane from (-35, 0) to (0, -35) cuts the corner edges of (-20, -20).
    expect(pairs).not.toContainEqual([-2, -1]);
  });

  it("in 'nearby' mode also reaches existing systems, but every lane touches a new point", () => {
    const pairs = strokeLanes({ ...base, mode: "nearby" });
    const at = positions([...ADDED, ...NEARBY]);
    expect(pairs.some(([, b]) => b > 0)).toBe(true);
    expect(pairs.every(([a, b]) => a < 0 || b < 0)).toBe(true);
    expect(crossings(pairs, at)).toBe(0);
    for (const [a, b] of pairs) {
      const p = at.get(a)!;
      const q = at.get(b)!;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThanOrEqual(MAX);
    }
  });

  it("drops edges longer than maxLength", () => {
    const pairs = strokeLanes({ ...base, mode: "nearby", maxLength: 12 });
    expect(pairs.every(([, b]) => b < 0)).toBe(true);
  });
});

describe("meshWithin", () => {
  it("meshes existing systems for the Connect brush, skipping linked pairs and crossings", () => {
    const points: MeshPoint[] = NEARBY;
    const linked = new Set(["1,2"]);
    const pairs = meshWithin(points, {
      beta: MESH_BETA.dense,
      maxLength: 100,
      existing: EXISTING,
      keep: (a, b) => !linked.has(`${a},${b}`),
    });
    expect(pairs).not.toContainEqual([1, 2]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(crossings(pairs, positions(points))).toBe(0);
  });
});
