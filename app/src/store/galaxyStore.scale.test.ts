import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { SystemNode } from "../generated/SystemNode";
import { editor, mocked, openFixtureSave } from "./editorFixture";
import { editResult, OPEN_RESULT, systemNode } from "./fixture";
import { galaxyIslandCount, galaxyLaneCount, selectionLanes, useGalaxyStore } from "./galaxyStore";

/** A 94 x 94 lattice: 8,836 systems, each laned to its right and lower neighbours. */
const SIDE = 94;
/** The column whose lanes to the right are left out, splitting the lattice in two. */
const CUT = 46;
const SYSTEM_COUNT = SIDE * SIDE;
const LANE_COUNT = 2 * SIDE * (SIDE - 1) - SIDE;

function hugeGalaxy(): SystemNode[] {
  const lanes = Array.from({ length: SYSTEM_COUNT }, () => [] as number[]);
  const link = (a: number, b: number) => {
    lanes[a].push(b);
    lanes[b].push(a);
  };
  for (let row = 0; row < SIDE; row++) {
    for (let col = 0; col < SIDE; col++) {
      const id = row * SIDE + col;
      if (col + 1 < SIDE && col !== CUT) link(id, id + 1);
      if (row + 1 < SIDE) link(id, id + SIDE);
    }
  }
  return lanes.map((to, id) =>
    systemNode({
      id,
      x: (id % SIDE) * 20,
      y: Math.floor(id / SIDE) * 20,
      lanes: to.map((t) => ({ to: t, length: 20, bridge: false, stale: false })),
    }),
  );
}

describe("a galaxy of 8,836 systems and 17,390 lanes, all of it selected", () => {
  beforeEach(async () => {
    await openFixtureSave();
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: hugeGalaxy() });
    await editor().selectAll();
  });

  it("counts the lanes between the selected systems, the pairs without one and the islands", () => {
    const { systems } = useGalaxyStore.getState();
    const { selection } = editor();
    expect(selection).toHaveLength(SYSTEM_COUNT);
    const lanes = selectionLanes(systems, selection);
    expect(lanes.linked).toHaveLength(LANE_COUNT);
    expect(lanes.unlinked).toBe((SYSTEM_COUNT * (SYSTEM_COUNT - 1)) / 2 - LANE_COUNT);
    expect(galaxyLaneCount(systems)).toBe(LANE_COUNT);
    expect(galaxyIslandCount(systems)).toBe(2);
  });

  it("keeps the counts through a move and recounts after a lane joins the halves", () => {
    const moved = { ...useGalaxyStore.getState().systems.get(0)!, x: -5 };
    useGalaxyStore.getState().applyDelta({ systems: [moved] });
    const afterMove = useGalaxyStore.getState().systems;
    expect(galaxyIslandCount(afterMove)).toBe(2);
    expect(selectionLanes(afterMove, editor().selection).linked).toHaveLength(LANE_COUNT);

    const [a, b] = [CUT, CUT + 1].map((id) => afterMove.get(id)!);
    const lane = { length: 20, bridge: false, stale: false };
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...a, lanes: [...a.lanes, { ...lane, to: b.id }] },
        { ...b, lanes: [...b.lanes, { ...lane, to: a.id }] },
      ],
    });
    const joined = useGalaxyStore.getState().systems;
    expect(galaxyIslandCount(joined)).toBe(1);
    expect(galaxyLaneCount(joined)).toBe(LANE_COUNT + 1);
    expect(selectionLanes(joined, editor().selection).linked).toHaveLength(LANE_COUNT + 1);
  });

  it("cuts every lane between the selected systems in one op", async () => {
    mocked.applyOp.mockResolvedValue(editResult());
    await editor().cutLanesBetweenSelected();
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    const op = mocked.applyOp.mock.calls[0][0];
    expect(op.type === "RemoveLanePairs" && op.lanes.length).toBe(LANE_COUNT);
    expect(op.type === "RemoveLanePairs" && op.lanes.slice(0, 2)).toEqual([
      [0, 1],
      [0, SIDE],
    ]);
  });
});
