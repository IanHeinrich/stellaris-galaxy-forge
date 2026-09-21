import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { SYSTEMS, editResult, node } from "./fixture";

const headerEmpireCounts = vi.mocked(ipc.headerEmpireCounts);

/** Puts `pair` on the fixture systems `ids`, as the galaxy the store reads. */
function paired(pair: number | null, ...ids: number[]): void {
  useGalaxyStore.getState().applyDelta({
    systems: ids.map((id) => ({ ...SYSTEMS[id], wormhole_pair: pair })),
  });
}

beforeEach(async () => {
  await openFixtureSave();
});

describe("header empire counts", () => {
  it("updateEmpireCounts writes what the shell computes as one SetHeaderKeys", async () => {
    const entries: Array<[string, string]> = [
      ["num_empires", "{ min = 0 max = 4 }"],
      ["num_empire_default", "3"],
    ];
    headerEmpireCounts.mockResolvedValueOnce(entries);
    mocked.applyOp.mockResolvedValueOnce(editResult());
    await editor().updateEmpireCounts();
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "SetHeaderKeys", entries });
  });

  it("updateEmpireCounts reports a shell that refuses and sends nothing", async () => {
    headerEmpireCounts.mockRejectedValueOnce({ kind: "op", message: "only a scenario" });
    await editor().updateEmpireCounts();
    expect(mocked.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("only a scenario");
  });
});

describe("wormhole pairs", () => {
  it("linkWormholePair numbers the new pair past every pair in use, from 1, and shows the layer", async () => {
    mocked.applyOp.mockResolvedValue(editResult());
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, day_one_bypasses: false },
    });
    await editor().linkWormholePair(0, 3);
    expect(useMapChromeStore.getState().layers.day_one_bypasses).toBe(true);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 0,
      b: 3,
      pair: 1,
    });

    paired(4, 1, 2);
    await editor().linkWormholePair(0, 3);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 0,
      b: 3,
      pair: 5,
    });
  });

  it("unlinkWormholePair parts two ends of one pair, and refuses systems that share none", async () => {
    mocked.applyOp.mockResolvedValue(editResult());
    paired(2, 1, 2);
    expect(await editor().unlinkWormholePair(1, 2)).toBe(true);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 1,
      b: 2,
      pair: null,
    });

    expect(await editor().unlinkWormholePair(1, 3)).toBe(false);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
  });
});

describe("marauder clans", () => {
  /** Makes the fixture systems `ids` clan homes, numbered from 1, as the galaxy the store reads. */
  function homes(...ids: number[]): void {
    useGalaxyStore.getState().applyDelta({
      systems: ids.map((id, i) => ({
        ...SYSTEMS[id],
        initializer: `marauder_${i + 1}_1`,
        marauder: { home: i + 1 },
      })),
    });
  }

  /** What the shell answers an op that makes `system` the clan home the op asked for. */
  function answersWith(system: ReturnType<typeof node>): void {
    mocked.applyOp.mockImplementationOnce(async (op) => {
      const initializer =
        op.type === "AddSystem" || op.type === "SetInitializer" ? op.initializer : null;
      const home = Number(initializer?.match(/^marauder_(\d)_1$/)?.[1]);
      const made = { ...system, initializer: initializer ?? "", marauder: { home } };
      mocked.getSystem.mockResolvedValueOnce({ system: made, neighbours: [], nebula: null });
      return editResult({ delta: { systems: [made] } });
    });
  }

  it("addMarauderClanAt adds and selects a nameless home of the next free clan, and shows the clans", async () => {
    homes(0);
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, marauders: false },
    });
    answersWith(node(9, "", -120, 45, "sc_g"));

    expect(await editor().addMarauderClanAt({ x: -120, y: 45 })).toBe(true);

    const added = useGalaxyStore.getState().systems.get(9)!;
    expect([added.x, added.y]).toEqual([-120, 45]);
    expect(added.marauder).toEqual({ home: 2 });
    expect(added.name.key).toBe("");
    expect(editor().selection).toEqual([9]);
    expect(useMapChromeStore.getState().layers.marauders).toBe(true);
  });

  it("makeMarauderHome gives a system the next free clan and shows the clans", async () => {
    homes(0, 1);
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, marauders: false },
    });
    answersWith(SYSTEMS[3]);

    expect(await editor().makeMarauderHome(3)).toBe(true);

    expect(useGalaxyStore.getState().systems.get(3)!.marauder).toEqual({ home: 3 });
    expect(useMapChromeStore.getState().layers.marauders).toBe(true);
  });

  it("removeMarauderClan sets the system back to random", async () => {
    homes(0);
    mocked.applyOp.mockResolvedValueOnce(editResult());
    expect(await editor().removeMarauderClan(0)).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "SetInitializer",
      id: 0,
      initializer: null,
    });
  });

  it("addMarauderClanAt refuses once all three clans are placed, and says so", async () => {
    homes(0, 1, 2);
    expect(await editor().addMarauderClanAt({ x: 0, y: 0 })).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("All three clans are placed");
  });
});
