import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { PairSet } from "../geometry/pairs";
import { segmentsCross } from "../geometry/segments";
import { MESH_BETA } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import { SpatialGrid } from "../spatialGrid";
import { drag } from "../../test/brush";
import { lanesTo, placedNode, systemNode } from "../../test/builders";
import { SYSTEMS as SAMPLE } from "../../store/fixture";
import type { Symmetry } from "../geometry/symmetry";
import { provisionalId, provisionalIndex } from "../placement/lanes";
import { stampsAlong } from "./stroke";
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
  height: {
    mode: "raise",
    value: 0,
    raise: 10,
    smooth: 0.5,
    ripple: { height: 40, spacing: 30, fade: 60 },
    flipped: false,
  },
};
const ERASE: BrushSettings = { ...PAINT, tool: "erase", size: 20 };

function stroke(settings: BrushSettings, seed = 7): BrushStroke {
  const grid = new SpatialGrid();
  grid.build(SYSTEMS);
  return new BrushStroke(settings, GALAXY, grid, seed, { systems: GALAXY, grid });
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
    const at = (id: number): Pt => (id < 0 ? points[provisionalIndex(id)] : GALAXY.get(id)!);
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
    const pairs = new PairSet();
    for (const [a, b] of result.pairs) pairs.add(a, b);
    const image = (id: number) => provisionalId(provisionalIndex(id) + half);
    for (const [a, b] of result.pairs) {
      if (provisionalIndex(a) >= half) continue;
      expect(pairs.has(image(a), image(b))).toBe(true);
    }
  });
});

describe("a paint stroke's exact output", () => {
  /** Points as "x,y" and pairs as "a b", rounded so only a change in placement shows. */
  function pinned(settings: Partial<BrushSettings>, systems: SystemNode[], path: Pt[]) {
    const galaxy = new Map(systems.map((s) => [s.id, s]));
    const grid = new SpatialGrid();
    grid.build(systems);
    const s = new BrushStroke({ ...PAINT, spacing: 20, ...settings }, galaxy, grid, 7, {
      systems: galaxy,
      grid,
    });
    for (const stamps of drag(path, s.r)) s.add(stamps);
    const result = s.result();
    if (result.kind !== "paint") throw new Error(result.kind);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return {
      points: result.points.map((p) => `${round(p.x)},${round(p.y)}`),
      pairs: result.pairs.map(([a, b]) => `${a} ${b}`),
    };
  }

  it("places the same systems and lanes as before, without symmetry", () => {
    expect(pinned({ laneMode: "new" }, SYSTEMS, ALONG_LANE)).toMatchInlineSnapshot(`
      {
        "pairs": [
          "-12 -11",
          "-12 -9",
          "-11 -10",
          "-11 -9",
          "-10 -9",
          "-10 -8",
          "-9 -8",
          "-8 -7",
          "-8 -6",
          "-7 -6",
          "-6 -4",
          "-5 -4",
          "-5 -3",
          "-5 -1",
          "-4 -1",
          "-3 -2",
          "-3 -1",
          "-2 -1",
        ],
        "points": [
          "4.965,30.366",
          "-15.83,26.988",
          "-5.048,48.116",
          "25.995,28.348",
          "18.962,48.627",
          "46.013,32.449",
          "58.766,48.284",
          "65.885,28.097",
          "86.077,35.157",
          "78.907,11.118",
          "103.198,23.118",
          "109.735,46.617",
        ],
      }
    `);
  });

  it("places the same systems and lanes as before, in three turns beside existing lanes", () => {
    // Each third has a lane under the stroke, a system above it and one past the lane.
    const third = [
      placedNode(1, 100, 0, [2]),
      placedNode(2, 160, 0, [1]),
      placedNode(3, 130, 45),
      placedNode(4, 130, -25),
    ];
    const turned = [0, 1, 2].flatMap((k) => {
      const [c, s] = [Math.cos((2 * Math.PI * k) / 3), Math.sin((2 * Math.PI * k) / 3)];
      return third.map((n) => ({
        ...n,
        id: n.id + 10 * k,
        x: n.x * c - n.y * s,
        y: n.x * s + n.y * c,
        lanes: n.lanes.map((l) => ({ ...l, to: l.to + 10 * k })),
      }));
    });
    const path = [
      { x: 100, y: 22 },
      { x: 130, y: 25 },
      { x: 160, y: 22 },
    ];
    const rotate = { laneMode: "nearby", symmetry: { kind: "rotate", n: 3 } } as const;
    expect(pinned(rotate, turned, path)).toMatchInlineSnapshot(`
      {
        "pairs": [
          "-21 -19",
          "-21 22",
          "-20 -19",
          "-20 -18",
          "-20 22",
          "-19 -18",
          "-19 22",
          "-19 23",
          "-18 -15",
          "-18 23",
          "-17 -16",
          "-17 -15",
          "-17 23",
          "-16 -15",
          "-16 21",
          "-15 21",
          "-14 -12",
          "-14 12",
          "-13 -12",
          "-13 -11",
          "-13 12",
          "-12 -11",
          "-12 12",
          "-12 13",
          "-11 -8",
          "-11 13",
          "-10 -9",
          "-10 -8",
          "-10 13",
          "-9 -8",
          "-9 11",
          "-8 11",
          "-7 -5",
          "-7 2",
          "-6 -5",
          "-6 -4",
          "-6 2",
          "-5 -4",
          "-5 2",
          "-5 3",
          "-4 -1",
          "-4 3",
          "-3 -2",
          "-3 -1",
          "-3 3",
          "-2 -1",
          "-2 1",
          "-1 1",
        ],
        "points": [
          "104.965,22.366",
          "84.17,18.988",
          "94.952,40.116",
          "125.995,20.348",
          "145.85,27.484",
          "139.139,4.884",
          "165.151,35.143",
          "-71.852,79.719",
          "-58.529,63.4",
          "-82.217,62.172",
          "-80.619,98.941",
          "-96.726,112.568",
          "-73.8,118.056",
          "-113.01,125.453",
          "-33.113,-102.085",
          "-25.641,-82.387",
          "-12.734,-102.288",
          "-45.375,-119.289",
          "-49.123,-140.051",
          "-65.34,-122.94",
          "-52.141,-160.596",
        ],
      }
    `);
  });

  it("places the same systems and lanes as before, mirrored", () => {
    const path = [
      { x: 200, y: 100 },
      { x: 230, y: 110 },
      { x: 260, y: 100 },
    ];
    const mirror = { laneMode: "new", symmetry: { kind: "mirror", axis: "y" } } as const;
    expect(pinned(mirror, SYSTEMS, path)).toMatchInlineSnapshot(`
      {
        "pairs": [
          "-20 -19",
          "-20 -17",
          "-19 -17",
          "-19 -16",
          "-18 -12",
          "-18 -11",
          "-17 -16",
          "-17 -14",
          "-16 -15",
          "-16 -14",
          "-15 -14",
          "-15 -13",
          "-15 -11",
          "-14 -11",
          "-13 -12",
          "-13 -11",
          "-12 -11",
          "-10 -9",
          "-10 -7",
          "-9 -7",
          "-9 -6",
          "-8 -2",
          "-8 -1",
          "-7 -6",
          "-7 -4",
          "-6 -5",
          "-6 -4",
          "-5 -4",
          "-5 -3",
          "-5 -1",
          "-4 -1",
          "-3 -2",
          "-3 -1",
          "-2 -1",
        ],
        "points": [
          "204.965,100.366",
          "184.17,96.988",
          "194.952,118.116",
          "225.995,98.348",
          "215.851,120.696",
          "237.136,120.023",
          "247.202,93.373",
          "198.703,80.419",
          "258.649,117.945",
          "267.213,95.706",
          "-204.965,100.366",
          "-184.17,96.988",
          "-194.952,118.116",
          "-225.995,98.348",
          "-215.851,120.696",
          "-237.136,120.023",
          "-247.202,93.373",
          "-198.703,80.419",
          "-258.649,117.945",
          "-267.213,95.706",
        ],
      }
    `);
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
  const s = new BrushStroke({ ...PAINT, tool: "connect", ...settings }, galaxy, grid, 3, {
    systems: galaxy,
    grid,
  });
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

describe("a stroke over the sample galaxy", () => {
  const SAMPLE_ERASE: BrushSettings = { ...ERASE, size: 6, spacing: 25, laneMode: "off", beta: 1 };
  const MIRROR_X: Symmetry = { kind: "mirror", axis: "x" };
  const QUARTER: Symmetry = { kind: "rotate", n: 4 };
  // Sol, Alpha Centauri, Barnard and Sirius, whose chain already links Alpha Centauri to the others.
  const CHAIN = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
  ];

  /** A stroke through `path` over the sample galaxy with `over` laid on top of it. */
  function sampleStroke(
    settings: Partial<BrushSettings>,
    path: Pt[],
    over: SystemNode[] = [],
  ): StrokeResult {
    const galaxy = new Map(SAMPLE.map((s) => [s.id, s]));
    for (const s of over) galaxy.set(s.id, s);
    const grid = new SpatialGrid();
    grid.build(galaxy.values());
    const s = new BrushStroke({ ...SAMPLE_ERASE, ...settings }, galaxy, grid, 1, {
      systems: galaxy,
      grid,
    });
    let prev: Pt | null = null;
    for (const next of path) {
      s.add(stampsAlong(prev, next, s.r));
      prev = next;
    }
    return s.result();
  }

  it("erases Sol and keeps the special Alpha Centauri unless told to take it", () => {
    const sol = { ...SAMPLE[0], initializer: "" };
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(sampleStroke({}, path, [sol])).toEqual({ kind: "erase", doomed: [0], kept: [1] });
    expect(sampleStroke({ eraseSpecials: true }, path, [sol])).toEqual({
      kind: "erase",
      doomed: [0, 1],
      kept: [],
    });
  });

  it("cuts the lane it passes over in lanes mode", () => {
    // Short of Alpha Centauri, whose other lanes a stamp on it would cut too.
    const path = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    expect(sampleStroke({ eraseTarget: "lanes" }, path)).toEqual({ kind: "cut", lanes: [[0, 1]] });
    expect(sampleStroke({ tool: "cut" }, path)).toEqual({ kind: "cut", lanes: [[0, 1]] });
  });

  it("meshes the systems a connect stroke passes over, leaving out pairs already linked", () => {
    expect(sampleStroke({ tool: "connect", size: 30, beta: 0.1 }, CHAIN)).toEqual({
      kind: "connect",
      swept: [0, 1, 2, 3],
      pairs: [
        [0, 2],
        [2, 3],
      ],
      sparse: false,
    });
    // The Gabriel graph drops Sol–Barnard, whose circle holds Alpha Centauri.
    expect(sampleStroke({ tool: "connect", size: 30, beta: 1 }, CHAIN)).toMatchObject({
      pairs: [[2, 3]],
    });
  });

  it("connects no pair the scenario keeps apart", () => {
    const kept = [
      { ...SAMPLE[2], prevented: [3] },
      { ...SAMPLE[3], prevented: [2] },
    ];
    expect(sampleStroke({ tool: "connect", size: 30, beta: 0.1 }, CHAIN, kept)).toMatchObject({
      pairs: [[0, 2]],
    });
  });

  it("connects no pair whose lane would cross an existing one", () => {
    // Either side of the Alpha Centauri–Vega lane, so the one lane between them would cross it.
    const sides = [placedNode(6, 0, -15), placedNode(7, 20, -15)];
    const path = [
      { x: 0, y: -15 },
      { x: 20, y: -15 },
    ];
    expect(sampleStroke({ tool: "connect" }, path, sides)).toEqual({
      kind: "connect",
      swept: [6, 7],
      pairs: [],
      sparse: false,
    });
  });

  it("erases what every image of the stroke passes over", () => {
    const pair = [placedNode(10, 100, 50), placedNode(11, 100, -50)];
    expect(sampleStroke({ symmetry: MIRROR_X }, [{ x: 100, y: 50 }], pair)).toEqual({
      kind: "erase",
      doomed: [10, 11],
      kept: [],
    });
    const quarter = [
      ...pair,
      placedNode(12, -50, 100),
      placedNode(13, -100, -50),
      placedNode(14, 50, -100),
    ];
    expect(sampleStroke({ symmetry: QUARTER }, [{ x: 100, y: 50 }], quarter)).toEqual({
      kind: "erase",
      doomed: [10, 12, 13, 14],
      kept: [],
    });
  });

  it("cuts the lanes every image of the stroke passes over", () => {
    const lanes = [
      placedNode(10, 60, 50, [11]),
      placedNode(11, 100, 50, [10]),
      placedNode(12, -60, 50, [13]),
      placedNode(13, -100, 50, [12]),
    ];
    const cut = sampleStroke(
      { tool: "cut", symmetry: { kind: "mirror", axis: "y" } },
      [{ x: 80, y: 50 }],
      lanes,
    );
    expect(cut).toEqual({
      kind: "cut",
      lanes: [
        [10, 11],
        [12, 13],
      ],
    });
  });

  it("connects only lane patterns every copy repeats, so a square gets its sides and no diagonal", () => {
    const square = [
      placedNode(10, 300, 0),
      placedNode(11, 0, 300),
      placedNode(12, -300, 0),
      placedNode(13, 0, -300),
    ];
    const settings = { tool: "connect", size: 10, beta: 0.1, symmetry: QUARTER } as const;
    expect(sampleStroke(settings, [{ x: 300, y: 0 }], square)).toEqual({
      kind: "connect",
      swept: [10, 11, 12, 13],
      pairs: [
        [10, 11],
        [10, 13],
        [11, 12],
        [12, 13],
      ],
      sparse: false,
    });
  });

  it("connects the systems every image of the stroke passes over", () => {
    const halves = [
      placedNode(10, 60, 50),
      placedNode(11, 80, 50),
      placedNode(12, -60, -50),
      placedNode(13, -80, -50),
    ];
    const settings = { tool: "connect", size: 10, symmetry: { kind: "rotate", n: 2 } } as const;
    const path = [
      { x: 60, y: 50 },
      { x: 80, y: 50 },
    ];
    expect(sampleStroke(settings, path, halves)).toEqual({
      kind: "connect",
      swept: [10, 11, 12, 13],
      pairs: [
        [10, 11],
        [12, 13],
      ],
      sparse: false,
    });
  });
});
