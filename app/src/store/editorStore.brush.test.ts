import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { stampsAlong } from "../lib/brush/stroke";
import { BrushStroke, type BrushSettings } from "../lib/brush/brushStroke";
import { run } from "./commands";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT, SYSTEMS, editResult } from "./fixture";

const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn(), confirmRemoveNebula: vi.fn() };

const ERASE: BrushSettings = {
  tool: "erase",
  size: 6,
  spacing: 25,
  laneMode: "off",
  eraseTarget: "systems",
  eraseSpecials: false,
  symmetry: { kind: "off" },
  beta: 1,
};

/** An erase stroke over the galaxy the store holds, by default from Sol to Alpha Centauri. */
function erase(settings: Partial<BrushSettings> = {}, to = { x: 10, y: 0 }) {
  const { systems, grid } = useGalaxyStore.getState();
  const stroke = new BrushStroke({ ...ERASE, ...settings }, systems, grid!, 1);
  stroke.add(stampsAlong(null, { x: 0, y: 0 }, 3));
  stroke.add(stampsAlong({ x: 0, y: 0 }, to, 3));
  return stroke.result();
}

beforeEach(async () => {
  await openFixtureSave();
  mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
  await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  mocked.applyOp.mockResolvedValue(editResult());
});

describe("a paint stroke", () => {
  it("sends its systems under the next free ids and its lanes, to an existing system too, as one edit", async () => {
    const points = [
      { x: 200, y: 200 },
      { x: 212.5, y: 200 },
    ];
    await editor().paintStroke(points, [
      [-2, -1],
      [-1, 3],
    ]);
    const added = (id: number, p: { x: number; y: number }) => ({
      type: "AddSystem",
      id,
      x: p.x,
      y: p.y,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Painted 2 systems and 2 lanes",
      ops: [
        added(6, points[0]),
        added(7, points[1]),
        {
          type: "AddLanePairs",
          lanes: [
            { a: 7, b: 6, bridge: false },
            { a: 6, b: 3, bridge: false },
          ],
        },
      ],
    });
  });

  it("names one system and no lanes in the singular", async () => {
    await editor().paintStroke([{ x: 200, y: 200 }], []);
    expect(mocked.applyOp.mock.calls[0][0]).toMatchObject({
      type: "Batch",
      description: "Painted 1 system",
    });
  });

  it("sends nothing for an empty stroke", async () => {
    expect(await editor().paintStroke([], [])).toBe(false);
    expect(await editor().eraseStroke([])).toBe(false);
    expect(await editor().cutLanes([])).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});

describe("an erase stroke", () => {
  it("keeps the special systems it passes over unless told to take them", async () => {
    useGalaxyStore.getState().applyDelta({ systems: [{ ...SYSTEMS[0], initializer: "" }] });

    const kept = erase();
    expect(kept).toEqual({ kind: "erase", doomed: [0], kept: [1] });
    await editor().eraseStroke(kept.kind === "erase" ? kept.doomed : []);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 1 system",
      ops: [{ type: "RemoveSystem", id: 0 }],
    });

    const taken = erase({ eraseSpecials: true });
    await editor().eraseStroke(taken.kind === "erase" ? taken.doomed : []);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 2 systems",
      ops: [
        { type: "RemoveSystem", id: 0 },
        { type: "RemoveSystem", id: 1 },
      ],
    });
  });

  it("cuts the lanes it passes over in lanes mode, as one edit", async () => {
    // Short of Alpha Centauri, whose other lanes a stamp on it would cut too.
    const cut = erase({ eraseTarget: "lanes" }, { x: 5, y: 0 });
    expect(cut).toEqual({ kind: "cut", lanes: [[0, 1]] });
    await editor().cutLanes(cut.kind === "cut" ? cut.lanes : []);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Cut 1 lane",
      ops: [{ type: "RemoveLanePairs", lanes: [[0, 1]] }],
    });
  });

  it("a refused stroke reports why and leaves the galaxy as it was", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "no such system" });
    expect(await editor().eraseStroke([0])).toBe(false);
    expect(sessionError()).toBe("no such system");
    expect(useGalaxyStore.getState().systems.has(0)).toBe(true);
  });
});

describe("deleting a selection of systems", () => {
  it("asks, counting each lane touching them once, then removes them all as one edit", async () => {
    await editor().setSelection([0, 1, 2], "replace");
    run("deleteSelection", false, effects);
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalled());
    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete 3 systems and their 4 lanes?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Deleted 3 systems",
      ops: [0, 1, 2].map((id) => ({ type: "RemoveSystem", id })),
    });
  });

  it("sends nothing when the question is declined", async () => {
    mocked.confirm.mockResolvedValueOnce(false);
    await editor().setSelection([0, 5], "replace");
    await editor().deleteSelection();
    expect(mocked.confirm).toHaveBeenCalledWith("Delete 2 systems and their 1 lane?", {
      title: "Delete systems",
      kind: "warning",
    });
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("leaves a save's systems, and a single selected system, alone", async () => {
    await editor().select(3);
    await editor().deleteSelection();
    await openFixtureSave();
    await editor().setSelection([0, 1], "replace");
    await editor().deleteSelection();
    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});
