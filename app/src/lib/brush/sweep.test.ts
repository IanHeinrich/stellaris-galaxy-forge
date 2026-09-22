import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { systemNode } from "../../test/builders";
import { SpatialGrid } from "../spatialGrid";
import { laneSegments } from "./lanes";
import { isSpecialSystem } from "./special";
import { stampsAlong } from "./stroke";
import { sweptLanes, sweptSystems } from "./sweep";

function lane(to: number) {
  return { to, length: 0, bridge: false, stale: false };
}

const SYSTEMS: SystemNode[] = [
  systemNode({ id: 1, x: 0, y: 0, lanes: [lane(2)] }),
  systemNode({ id: 2, x: 50, y: 4, lanes: [lane(1), lane(3)] }),
  systemNode({ id: 3, x: 100, y: 60, lanes: [lane(2), lane(4)] }),
  systemNode({ id: 4, x: 100, y: -60, lanes: [lane(3)] }),
  systemNode({ id: 5, x: 25, y: 6, initializer: "guardians_init_dragon" }),
  systemNode({ id: 6, x: 25, y: 30 }),
];
const R = 10;
const STAMPS = [{ x: 0, y: 0 }, ...stampsAlong({ x: 0, y: 0 }, { x: 60, y: 0 }, R)];

function grid(systems: SystemNode[]): SpatialGrid {
  const g = new SpatialGrid();
  g.build(systems);
  return g;
}

describe("sweptSystems", () => {
  it("removes the systems under the stroke and spares the specials unless told otherwise", () => {
    expect(sweptSystems(STAMPS, R, grid(SYSTEMS))).toEqual({ doomed: [1, 2], kept: [5] });
    expect(sweptSystems(STAMPS, R, grid(SYSTEMS), { includeSpecials: true })).toEqual({
      doomed: [1, 2, 5],
      kept: [],
    });
    expect(sweptSystems(STAMPS, R, grid(SYSTEMS), { isSpecial: (s) => s.id === 1 })).toEqual({
      doomed: [2, 5],
      kept: [1],
    });
  });
});

describe("sweptLanes", () => {
  it("cuts the lanes passing within r of a stamp, once each", () => {
    const lanes = laneSegments(SYSTEMS);
    expect(sweptLanes(STAMPS, R, lanes)).toEqual([
      [1, 2],
      [2, 3],
    ]);
    // A stamp between 3 and 4 cuts the lane they share without touching either system.
    expect(sweptLanes([{ x: 105, y: 0 }], R, [...lanes, ...lanes])).toEqual([[3, 4]]);
  });
});

describe("isSpecialSystem", () => {
  it("flags the systems the Paint a Galaxy and save fields single out, and nothing else", () => {
    expect(isSpecialSystem(systemNode())).toBe(false);
    expect(isSpecialSystem(systemNode({ flags: ["hostile_system"] }))).toBe(false);
    const special: Partial<SystemNode>[] = [
      { initializer: "guardians_init_dragon" },
      { spawn_weight: 10 },
      { spawn_design: "empire_design_x" },
      { marauder: { home: 1 } },
      { wormhole_pair: 3 },
      { bypass_ids: [12] },
      { fe_link: { custom: false, id: null, to: [7] } },
      { flags: ["lcluster_1"] },
      {
        fe_zone: {
          direction: "n",
          kind: "random",
          distance: 40,
          preferred: true,
          fallback: false,
        },
      },
    ];
    for (const over of special) expect(isSpecialSystem(systemNode(over))).toBe(true);
  });
});
