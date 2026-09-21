import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { SYSTEMS, editResult } from "./fixture";

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
