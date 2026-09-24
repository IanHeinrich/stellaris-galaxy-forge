import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { segmentsCross } from "../geometry/segments";
import { MESH_BETA } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import { SpatialGrid } from "../spatialGrid";
import { drag } from "../../test/brush";
import { lanesTo, systemNode } from "../../test/builders";
import { BrushStroke, strokeLabel, type BrushSettings, type StrokeResult } from "./brushStroke";

/** A lane 1-2 along y = 0, a guardian just above it, and a lone system far below. */
const SYSTEMS: SystemNode[] = [
  systemNode({ id: 1, x: 0, y: 0, lanes: lanesTo(2) }),
  systemNode({ id: 2, x: 100, y: 0, lanes: lanesTo(1) }),
  systemNode({ id: 3, x: 50, y: 5, initializer: "guardians_init_dragon" }),
  systemNode({ id: 4, x: 0, y: -200 }),
];
const GALAXY = new Map(SYSTEMS.map((s) => [s.id, s]));

/** A flat triangle: 11 and 12 already lane to the hub 13 between them, but not to each other. */
const CONNECT_SYSTEMS: SystemNode[] = [
  systemNode({ id: 11, x: 0, y: 0, lanes: lanesTo(13) }),
  systemNode({ id: 12, x: 10, y: 0, lanes: lanesTo(13) }),
  systemNode({ id: 13, x: 5, y: 1, lanes: lanesTo(11, 12) }),
];
const CONNECT_GALAXY = new Map(CONNECT_SYSTEMS.map((s) => [s.id, s]));

const PAINT: BrushSettings = {
  tool: "paint",
  size: 40,
  spacing: 10,
  laneMode: "nearby",
  eraseTarget: "systems",
  eraseSpecials: false,
  symmetry: { kind: "off" },
  beta: MESH_BETA.gabriel,
};
const ERASE: BrushSettings = { ...PAINT, tool: "erase", size: 20 };

function stroke(settings: BrushSettings, seed = 7): BrushStroke {
  const grid = new SpatialGrid();
  grid.build(SYSTEMS);
  return new BrushStroke(settings, GALAXY, grid, seed);
}

function run(settings: BrushSettings, path: Pt[]): StrokeResult {
  const s = stroke(settings);
  for (const stamps of drag(path, settings.size / 2)) s.add(stamps);
  return s.result();
}

const ALONG_LANE = [
  { x: 0, y: 30 },
  { x: 40, y: 32 },
  { x: 100, y: 30 },
];

describe("a paint stroke", () => {
  it("previews exactly what it commits, however its moves were batched", () => {
    const moves = drag(ALONG_LANE, PAINT.size / 2);
    const previewed = stroke(PAINT);
    for (const stamps of moves) {
      previewed.add(stamps);
      previewed.result();
    }
    const committed = stroke(PAINT);
    committed.add(moves.flat());
    expect(previewed.result()).toEqual(committed.result());
  });

  it("scatters systems clear of the existing ones and joins them to their neighbours without crossing a lane", () => {
    const result = run(PAINT, ALONG_LANE);
    if (result.kind !== "paint") throw new Error(result.kind);
    const { points, pairs } = result;
    expect(points.length).toBeGreaterThan(5);
    for (const p of points) {
      for (const s of SYSTEMS) expect(Math.hypot(p.x - s.x, p.y - s.y)).toBeGreaterThanOrEqual(10);
    }
    expect(pairs.some(([, b]) => b >= 0)).toBe(true);
    const at = (id: number): Pt => (id < 0 ? points[-id - 1] : GALAXY.get(id)!);
    for (const [a, b] of pairs) {
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThanOrEqual(-points.length);
      expect(segmentsCross(at(a), at(b), SYSTEMS[0], SYSTEMS[1])).toBe(false);
    }
  });

  it("adds no lanes when lanes are off, and only among its own systems in the new mode", () => {
    const off = run({ ...PAINT, laneMode: "off" }, ALONG_LANE);
    expect(off.kind === "paint" && off.pairs).toEqual([]);
    const fresh = run({ ...PAINT, laneMode: "new" }, ALONG_LANE);
    if (fresh.kind !== "paint") throw new Error(fresh.kind);
    expect(fresh.pairs.length).toBeGreaterThan(0);
    expect(fresh.pairs.every(([a, b]) => a < 0 && b < 0)).toBe(true);
  });

  it("mirrors its systems and lanes about the galaxy centre", () => {
    const path = [
      { x: 200, y: 100 },
      { x: 260, y: 110 },
    ];
    const result = run(
      { ...PAINT, laneMode: "new", symmetry: { kind: "mirror", axis: "y" } },
      path,
    );
    if (result.kind !== "paint") throw new Error(result.kind);
    const half = result.points.length / 2;
    expect(half).toBeGreaterThan(0);
    result.points.slice(0, half).forEach((p, i) => {
      expect(result.points[half + i]).toEqual({ x: -p.x, y: p.y });
    });
    const pairs = new Set(result.pairs.map(([a, b]) => `${a},${b}`));
    for (const [a, b] of result.pairs) {
      if (a < -half) continue;
      expect(pairs.has(`${a - half},${b - half}`)).toBe(true);
    }
  });
});

describe("an erase stroke", () => {
  const ALONG = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("removes the systems it passes over and keeps the specials unless told otherwise", () => {
    expect(run(ERASE, ALONG)).toEqual({ kind: "erase", doomed: [1, 2], kept: [3] });
    expect(run({ ...ERASE, eraseSpecials: true }, ALONG)).toEqual({
      kind: "erase",
      doomed: [1, 2, 3],
      kept: [],
    });
  });

  it("also removes what the stroke's mirror image passes over", () => {
    const below = { ...ERASE, symmetry: { kind: "mirror", axis: "x" } } as const;
    expect(run(below, [{ x: 0, y: 200 }])).toEqual({ kind: "erase", doomed: [4], kept: [] });
  });

  it("cuts the lanes it passes over, and no system, in lanes mode", () => {
    expect(run({ ...ERASE, eraseTarget: "lanes" }, [{ x: 50, y: -8 }])).toEqual({
      kind: "cut",
      lanes: [[1, 2]],
    });
  });
});

/** A connect stroke that only touches the two points named, without sweeping what lies between them. */
function connectPoints(
  settings: Partial<BrushSettings>,
  systems: SystemNode[],
  galaxy: ReadonlyMap<number, SystemNode>,
  points: Pt[],
): StrokeResult {
  const grid = new SpatialGrid();
  grid.build(systems);
  const s = new BrushStroke({ ...PAINT, tool: "connect", ...settings }, galaxy, grid, 3);
  for (const p of points) s.add([p]);
  return s.result();
}

describe("a connect stroke", () => {
  it("says nothing of density once the systems it swept are already linked", () => {
    const result = connectPoints({}, SYSTEMS, GALAXY, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(result).toEqual({ kind: "connect", swept: [1, 2], pairs: [], sparse: false });
  });

  it("flags when raising the lane density would add a lane the current one would not", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 1 },
    ];
    const gabriel = connectPoints(
      { beta: MESH_BETA.gabriel },
      CONNECT_SYSTEMS,
      CONNECT_GALAXY,
      points,
    );
    expect(gabriel).toEqual({ kind: "connect", swept: [11, 12, 13], pairs: [], sparse: true });

    const dense = connectPoints({ beta: MESH_BETA.dense }, CONNECT_SYSTEMS, CONNECT_GALAXY, points);
    expect(dense).toEqual({
      kind: "connect",
      swept: [11, 12, 13],
      pairs: [[11, 12]],
      sparse: false,
    });
  });
});

describe("the stroke's count", () => {
  it("says what the release would do", () => {
    const p = { x: 0, y: 0 };
    expect(strokeLabel({ kind: "paint", points: [p, p, p], pairs: [[-2, -1]] })).toBe(
      "+3 systems · +1 lane",
    );
    expect(strokeLabel({ kind: "erase", doomed: [1], kept: [] })).toBe("−1 system");
    expect(strokeLabel({ kind: "erase", doomed: [1, 2], kept: [3, 4] })).toBe(
      "−2 systems · 2 special kept",
    );
    expect(
      strokeLabel({
        kind: "cut",
        lanes: [
          [1, 2],
          [2, 3],
        ],
      }),
    ).toBe("−2 lanes");
    expect(strokeLabel({ kind: "connect", swept: [1, 2], pairs: [[1, 2]], sparse: false })).toBe(
      "+1 lane",
    );
    expect(strokeLabel({ kind: "connect", swept: [1, 2], pairs: [], sparse: false })).toBe(
      "+0 lanes",
    );
    expect(strokeLabel({ kind: "connect", swept: [1, 2, 3], pairs: [], sparse: true })).toBe(
      "+0 lanes · raise lane density",
    );
  });
});
