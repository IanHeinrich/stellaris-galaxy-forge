import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "../generated/Op";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, mocked, openFixtureSave } from "./editorFixture";
import { useMapChromeStore } from "./mapChromeStore";
import { CONNECT_ALL_MAX, type EditorState } from "./editorStore";
import { MESH_BETA } from "../lib/geometry/mesh";
import { linkedPairs, meshLanes, useGalaxyStore } from "./galaxyStore";
import { editResult, withLaneLength } from "./fixture";

beforeEach(openFixtureSave);

describe("bulk lane actions", () => {
  beforeEach(() => {
    mocked.applyOp.mockResolvedValue(editResult());
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
        what: "isolateSelected sends IsolateSystems with only the systems that have lanes",
        ids: [4, 5],
        run: (s) => s.isolateSelected(),
        op: { type: "IsolateSystems", ids: [4] },
      },
    ];

  it.each(cases)("$what", async ({ ids, run, op }) => {
    await editor().setSelection(ids, "replace");
    await run(editor());
    expect(mocked.applyOp).toHaveBeenCalledWith(op);
  });

  it("skips the call when the action has nothing to do", async () => {
    await editor().setSelection([0, 1], "replace");
    await editor().connectSelected();
    await editor().select(5);
    await editor().isolateSelected();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("connectSelected refuses more than CONNECT_ALL_MAX systems", async () => {
    await editor().selectAll();
    expect(editor().selection.length).toBeGreaterThan(CONNECT_ALL_MAX);
    await editor().connectSelected();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("connectSelectedMesh sends the skeleton's missing lanes and clears the preview", async () => {
    await editor().selectAll();
    const { selection } = editor();
    const meshBeta = useMapChromeStore.getState().meshBeta;
    expect(meshBeta).toBe(MESH_BETA.gabriel);
    const systems = useGalaxyStore.getState().systems;
    const expected = meshLanes(systems, selection, meshBeta);
    expect(expected.length).toBeGreaterThan(0);
    const existing = linkedPairs(systems, selection).map(([a, b]) => `${a}-${b}`);
    for (const [a, b] of expected) expect(existing).not.toContain(`${a}-${b}`);

    useMapChromeStore.getState().setLanePreview(expected);
    await editor().connectSelectedMesh();
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddLanePairs",
      lanes: expected.map(([a, b]) => ({ a, b, bridge: false })),
    });
    expect(useMapChromeStore.getState().lanePreview).toBeNull();
  });

  it("setMeshBeta densifies the mesh monotonically", async () => {
    await editor().selectAll();
    const counts: number[] = [];
    for (const beta of [MESH_BETA.sparse, MESH_BETA.gabriel, MESH_BETA.dense]) {
      useMapChromeStore.getState().setMeshBeta(beta);
      mocked.applyOp.mockClear();
      await editor().connectSelectedMesh();
      expect(mocked.applyOp).toHaveBeenCalledTimes(1);
      const op = mocked.applyOp.mock.calls[0][0];
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
    expect(mocked.applyOp).not.toHaveBeenCalled();

    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: withLaneLength(1, 2, 99) } }),
    );
    await editor().applyOp({ type: "SetLaneLength", a: 1, b: 2, length: 99 });
    mocked.applyOp.mockClear();

    await editor().resetSelectedLaneLengths();
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "NormaliseLaneLengths",
      systems: [0, 1, 2],
    });
  });
});
