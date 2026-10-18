import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "../generated/Op";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor, joinBoth, openFixtureSave, openFixtureScenario } from "./editorFixture";
import { useMapChromeStore } from "./mapChromeStore";
import { CONNECT_ALL_MAX, type EditorState } from "./editorStore";
import { DEFAULT_LANE_DENSITY } from "../lib/geometry/mesh";
import { linkedPairs, meshLanes, useGalaxyStore } from "./galaxyStore";
import { editResult, withLaneLength } from "./fixture";
import { mockedIpc } from "../test/ipc";

beforeEach(openFixtureSave);

describe("bulk lane actions", () => {
  beforeEach(() => {
    mockedIpc.applyOp.mockResolvedValue(editResult());
  });

  const cases: Array<{ what: string; ids: number[]; run(s: EditorState): Promise<void>; op: Op }> =
    [
      {
        what: "connectSelected sends AddLanePairs for exactly the unlinked pairs",
        ids: [0, 2, 3],
        run: (s) => s.connectSelected(),
        op: {
          type: "AddLanePairs",
          lanes: [
            { a: 0, b: 2, bridge: false },
            { a: 0, b: 3, bridge: false },
            { a: 2, b: 3, bridge: false },
          ],
        },
      },
      {
        what: "connectSelectedTo sends AddLanes from the target to the unlinked selected systems",
        ids: [0, 1],
        run: (s) => s.connectSelectedTo(5),
        op: {
          type: "AddLanes",
          from: 5,
          to: [
            [0, false],
            [1, false],
          ],
        },
      },
      {
        what: "cutLanesBetweenSelected sends RemoveLanePairs for the linked pairs",
        ids: [0, 1, 2],
        run: (s) => s.cutLanesBetweenSelected(),
        op: {
          type: "RemoveLanePairs",
          lanes: [
            [0, 1],
            [1, 2],
          ],
        },
      },
      {
        what: "cutLanesToSelected sends RemoveLanes for the selected systems linked to the target",
        ids: [0, 5],
        run: (s) => s.cutLanesToSelected(1),
        op: { type: "RemoveLanes", from: 1, to: [0] },
      },
      {
        what: "swapSystems sends SwapSystems for the two systems",
        ids: [],
        run: async (s) => void (await s.swapSystems(3, 1)),
        op: { type: "SwapSystems", system: 3, with: 1 },
      },
      {
        what: "isolateSelected sends IsolateSystems with only the systems that have lanes",
        ids: [4, 5],
        run: (s) => s.isolateSelected(),
        op: { type: "IsolateSystems", systems: [4] },
      },
    ];

  it.each(cases)("$what", async ({ ids, run, op }) => {
    await editor().setSelection(ids, "replace");
    await run(editor());
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(op);
  });

  it("skips the call when the action has nothing to do", async () => {
    await editor().setSelection([0, 1], "replace");
    await editor().connectSelected();
    await editor().select(5);
    await editor().isolateSelected();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("connectSelected refuses more than CONNECT_ALL_MAX systems", async () => {
    await editor().selectAll();
    expect(editor().selection.length).toBeGreaterThan(CONNECT_ALL_MAX);
    await editor().connectSelected();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("connectSelectedMesh sends the mesh's missing lanes and clears the preview", async () => {
    useMapChromeStore.getState().setLaneIslands(false);
    await editor().selectAll();
    const { selection } = editor();
    const laneDensity = useMapChromeStore.getState().laneDensity;
    expect(laneDensity).toBe(DEFAULT_LANE_DENSITY);
    const systems = useGalaxyStore.getState().systems;
    const expected = meshLanes(systems, selection, laneDensity, false);
    expect(expected.length).toBeGreaterThan(0);
    const existing = linkedPairs(systems, selection).map(([a, b]) => `${a}-${b}`);
    for (const [a, b] of expected) expect(existing).not.toContain(`${a}-${b}`);

    useMapChromeStore.getState().setLanePreview(expected);
    await editor().connectSelectedMesh();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddLanePairs",
      lanes: expected.map(([a, b]) => ({ a, b, bridge: false })),
    });
    expect(useMapChromeStore.getState().lanePreview).toBeNull();
  });

  it("connectSelectedMesh lays the island lanes the row counts once the island setting is on", async () => {
    await editor().selectAll();
    const { selection } = editor();
    const systems = useGalaxyStore.getState().systems;
    const chrome = useMapChromeStore.getState();
    chrome.setLaneIslands(true);
    const islands = meshLanes(systems, selection, chrome.laneDensity, true);
    expect(islands).not.toEqual(meshLanes(systems, selection, chrome.laneDensity, false));

    await editor().connectSelectedMesh();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddLanePairs",
      lanes: islands.map(([a, b]) => ({ a, b, bridge: false })),
    });
    chrome.setLaneIslands(false);
  });

  it("setLaneDensity densifies the mesh monotonically", async () => {
    await editor().selectAll();
    const counts: number[] = [];
    for (const density of [0, DEFAULT_LANE_DENSITY, 1]) {
      useMapChromeStore.getState().setLaneDensity(density);
      mockedIpc.applyOp.mockClear();
      await editor().connectSelectedMesh();
      expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
      const op = mockedIpc.applyOp.mock.calls[0][0];
      expect(op.type).toBe("AddLanePairs");
      counts.push(op.type === "AddLanePairs" ? op.lanes.length : 0);
    }
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[2]).toBeGreaterThan(0);
  });

  it("resetSelectedLaneLengths normalises only when the core marked a lane stale", async () => {
    await editor().setSelection([0, 1, 2], "replace");
    await editor().resetSelectedLaneLengths();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();

    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: withLaneLength(1, 2, 99) } }),
    );
    await editor().applyOp({ type: "SetLaneLength", a: 1, b: 2, length: 99 });
    mockedIpc.applyOp.mockClear();

    await editor().resetSelectedLaneLengths();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "NormaliseLaneLengths",
      systems: [0, 1, 2],
    });
  });
});

describe("preventing and allowing lanes", () => {
  beforeEach(async () => {
    await openFixtureScenario();
    mockedIpc.applyOp.mockResolvedValue(editResult());
  });

  const sent = () => mockedIpc.applyOp.mock.calls[mockedIpc.applyOp.mock.calls.length - 1][0];

  it("cuts a lane and prevents it as one edit, and prevents a pair with no lane alone", async () => {
    await editor().preventLanes([[0, 1]]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut and prevented lane Sol #0 <-> Alpha Centauri #1",
      ops: [
        { type: "RemoveLane", a: 0, b: 1 },
        { type: "PreventLane", a: 0, b: 1 },
      ],
    });

    await editor().preventLanes([[5, 0]]);
    expect(sent()).toEqual({ type: "PreventLane", a: 5, b: 0 });
  });

  it("only cuts a lane the scenario already prevents", async () => {
    joinBoth("prevented", [0, 1]);
    await editor().preventLanes([[0, 1]]);
    expect(sent()).toEqual({ type: "RemoveLane", a: 0, b: 1 });
  });

  it("prevents lanes to the selected systems not kept from the target yet, and allows the ones that are", async () => {
    joinBoth("lanes", [0, 5]);
    joinBoth("prevented", [2, 5]);
    await editor().setSelection([0, 2, 3], "replace");

    await editor().preventLanesToSelected(5);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut 1 lane and prevented 2 lanes",
      ops: [
        { type: "RemoveLane", a: 0, b: 5 },
        { type: "PreventLane", a: 0, b: 5 },
        { type: "PreventLane", a: 3, b: 5 },
      ],
    });

    await editor().allowLanesToSelected(5);
    expect(sent()).toEqual({ type: "AllowLane", a: 2, b: 5 });
  });
});
