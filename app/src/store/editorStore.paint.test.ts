import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import type { SystemNode } from "../generated/SystemNode";
import { editor, openFixtureSave, sessionError } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { SYSTEMS, editResult, node } from "./fixture";
import { mockedIpc } from "../test/ipc";

const headerEmpireCounts = mockedIpc.headerEmpireCounts;

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
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await editor().updateEmpireCounts();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "SetHeaderKeys", entries });
  });

  it("updateEmpireCounts counts only once the edits queued before it have landed", async () => {
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const painting = editor().paintStroke([{ x: 100, y: 100 }], []);
    headerEmpireCounts.mockResolvedValueOnce([["num_empire_default", "3"]]);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    const counting = editor().updateEmpireCounts();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(headerEmpireCounts).not.toHaveBeenCalled();

    land(editResult());
    await Promise.all([painting, counting]);
    expect(headerEmpireCounts).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp.mock.calls.map(([op]) => op.type)).toEqual(["Batch", "SetHeaderKeys"]);
  });

  it("updateEmpireCounts reports a shell that refuses and sends nothing", async () => {
    headerEmpireCounts.mockRejectedValueOnce({ kind: "op", message: "only a scenario" });
    await editor().updateEmpireCounts();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("only a scenario");
  });
});

describe("wormhole pairs", () => {
  it("linkWormholePair numbers the new pair past every pair in use, from 1, and shows the layer", async () => {
    mockedIpc.applyOp.mockResolvedValue(editResult());
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, day_one_bypasses: false },
    });
    await editor().linkWormholePair(0, 3);
    expect(useMapChromeStore.getState().layers.day_one_bypasses).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 0,
      b: 3,
      pair: 1,
    });

    paired(4, 1, 2);
    await editor().linkWormholePair(0, 3);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 0,
      b: 3,
      pair: 5,
    });
  });

  it("unlinkWormholePair parts two ends of one pair, and refuses systems that share none", async () => {
    mockedIpc.applyOp.mockResolvedValue(editResult());
    paired(2, 1, 2);
    expect(await editor().unlinkWormholePair(1, 2)).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetWormholePair",
      a: 1,
      b: 2,
      pair: null,
    });

    expect(await editor().unlinkWormholePair(1, 3)).toBe(false);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
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

  const roleOf = (initializer: string | null): SystemNode["marauder"] => {
    const m = initializer?.match(/^marauder_(\d)_(\d)$/);
    if (!m) return null;
    return m[2] === "1" ? { home: Number(m[1]) } : { base: Number(m[1]) };
  };

  /**
   * A shell that answers the ops the clan actions send from the galaxy the store holds,
   * a batch's members against what the ones before them wrote.
   */
  function answerOps(): void {
    const current = () => useGalaxyStore.getState().systems;
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const system = current().get(id);
      if (!system) throw { kind: "not_found", message: `no system ${id}` };
      return { system, neighbours: [], nebula: null };
    });
    mockedIpc.applyOp.mockImplementation(async (op) => {
      const changed = new Map<number, SystemNode>();
      const get = (id: number) => changed.get(id) ?? current().get(id)!;
      const write = (system: SystemNode) => changed.set(system.id, system);
      const answer = (member: Op) => {
        if (member.type === "AddSystem") {
          if (changed.has(member.id!) || current().has(member.id!)) {
            throw { kind: "op", message: `system ${member.id} already exists` };
          }
          write(
            node(member.id!, "", member.x, member.y, "sc_g", [], {
              initializer: member.initializer ?? "",
              marauder: roleOf(member.initializer),
            }),
          );
        }
        if (member.type === "AddLanes") {
          const from = get(member.from);
          const lane = (to: number) => ({ to, length: 10, bridge: false, stale: false });
          write({ ...from, lanes: [...from.lanes, ...member.to.map(([to]) => lane(to))] });
          for (const [to] of member.to) {
            const s = get(to);
            write({ ...s, lanes: [...s.lanes, lane(member.from)] });
          }
        }
        if (member.type === "SetInitializers") {
          for (const { id, initializer } of member.entries) {
            write({ ...get(id), initializer: initializer ?? "", marauder: roleOf(initializer) });
          }
        }
      };
      if (op.type === "Batch") op.ops.forEach(answer);
      else answer(op);
      return editResult({ delta: { systems: [...changed.values()] } });
    });
  }

  const galaxy = () => useGalaxyStore.getState().systems;
  const linked = (a: number, b: number) =>
    galaxy()
      .get(a)!
      .lanes.some((l) => l.to === b) &&
    galaxy()
      .get(b)!
      .lanes.some((l) => l.to === a);

  it("addMarauderClanAt adds the next free clan as one op: a home at the point, two bases 20 and 25 out, hyperlaned to it", async () => {
    homes(0);
    answerOps();
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, marauders: false },
    });

    expect(await editor().addMarauderClanAt({ x: -120, y: 45 })).toBe(true);

    const home = galaxy().get(6)!;
    expect([home.x, home.y, home.initializer, home.name.key]).toEqual([
      -120,
      45,
      "marauder_2_1",
      "",
    ]);
    const second = galaxy().get(7)!;
    const third = galaxy().get(8)!;
    expect([second.initializer, third.initializer]).toEqual(["marauder_2_2", "marauder_2_3"]);
    expect(Math.hypot(second.x - home.x, second.y - home.y)).toBeCloseTo(20);
    expect(Math.hypot(third.x - home.x, third.y - home.y)).toBeCloseTo(25);
    expect(linked(6, 7) && linked(6, 8)).toBe(true);
    expect(editor().selection).toEqual([6]);
    expect(useMapChromeStore.getState().layers.marauders).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Added marauder clan 2",
      ops: [
        expect.objectContaining({ type: "AddSystem", id: 6, initializer: "marauder_2_1" }),
        expect.objectContaining({ type: "AddSystem", id: 7, initializer: "marauder_2_2" }),
        expect.objectContaining({ type: "AddSystem", id: 8, initializer: "marauder_2_3" }),
        {
          type: "AddLanes",
          from: 6,
          to: [
            [7, false],
            [8, false],
          ],
        },
      ],
    });
  });

  it("addMarauderClanAt queued behind a paint stroke numbers its systems past the ones the stroke took", async () => {
    homes(0);
    answerOps();
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const painting = editor().paintStroke([{ x: 200, y: 200 }], []);
    const adding = editor().addMarauderClanAt({ x: -120, y: 45 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    land(editResult({ delta: { systems: [node(6, "", 200, 200, "sc_g", [])] } }));
    expect(await adding).toBe(true);
    await painting;

    const [, [clan]] = mockedIpc.applyOp.mock.calls;
    const ids =
      clan.type === "Batch" ? clan.ops.flatMap((o) => (o.type === "AddSystem" ? [o.id] : [])) : [];
    expect(ids).toEqual([7, 8, 9]);
    expect(galaxy().get(7)!.initializer).toBe("marauder_2_1");
    expect(sessionError()).toBeNull();
    expect(editor().selection).toEqual([7]);
  });

  it("addMarauderClanAt refuses once all three clans are placed, and says so", async () => {
    homes(0, 1, 2);
    expect(await editor().addMarauderClanAt({ x: 0, y: 0 })).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("All three clans are placed");
  });

  it("makeMarauderClan makes the home and its two linked bases the next free clan in one op, _2 to the lower id", async () => {
    homes(0);
    answerOps();
    useMapChromeStore.setState({
      layers: { ...useMapChromeStore.getState().layers, marauders: false },
    });

    expect(await editor().makeMarauderClan(1, [3, 2])).toBe(true);

    expect(galaxy().get(1)!.marauder).toEqual({ home: 2 });
    expect(galaxy().get(2)!.initializer).toBe("marauder_2_2");
    expect(galaxy().get(3)!.initializer).toBe("marauder_2_3");
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(useMapChromeStore.getState().layers.marauders).toBe(true);
  });

  it("makeMarauderClan refuses a base with no hyperlane to the home, and says so", async () => {
    answerOps();
    expect(await editor().makeMarauderClan(1, [2, 5])).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("Both outposts need a hyperlane to the home");
  });

  it("removeMarauderClan sets the home and its bases back to random in one op", async () => {
    answerOps();
    await editor().makeMarauderClan(1, [2, 3]);
    mockedIpc.applyOp.mockClear();

    expect(await editor().removeMarauderClan(1)).toBe(true);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    for (const id of [1, 2, 3]) {
      expect(galaxy().get(id)!.marauder).toBeNull();
      expect(galaxy().get(id)!.initializer).toBe("");
    }
    expect(await editor().removeMarauderClan(3)).toBe(false);
  });

  it("renumberMarauderClan moves the home and its bases to another clan in one op, keeping each site", async () => {
    answerOps();
    await editor().makeMarauderClan(1, [2, 3]);
    homes(0);
    mockedIpc.applyOp.mockClear();

    expect(await editor().renumberMarauderClan(1, 3)).toBe(true);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(galaxy().get(1)!.initializer).toBe("marauder_3_1");
    expect(galaxy().get(2)!.initializer).toBe("marauder_3_2");
    expect(galaxy().get(3)!.initializer).toBe("marauder_3_3");

    mockedIpc.applyOp.mockClear();
    expect(await editor().renumberMarauderClan(1, 1)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("Clan 1 is in use");
  });

  it("addMarauderBases creates only the bases the home is missing as one op, each hyperlaned to it", async () => {
    answerOps();
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...SYSTEMS[1], initializer: "marauder_1_1", marauder: { home: 1 } },
        { ...SYSTEMS[2], initializer: "marauder_1_2", marauder: { base: 1 } },
      ],
    });

    expect(await editor().addMarauderBases(1)).toBe(true);

    const third = galaxy().get(6)!;
    expect(third.initializer).toBe("marauder_1_3");
    expect(Math.hypot(third.x - 10, third.y)).toBeCloseTo(25);
    expect(linked(1, 6)).toBe(true);
    expect(galaxy().has(7)).toBe(false);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Added outposts for marauder clan 1",
      ops: [
        expect.objectContaining({ type: "AddSystem", id: 6, initializer: "marauder_1_3" }),
        { type: "AddLanes", from: 1, to: [[6, false]] },
      ],
    });

    mockedIpc.applyOp.mockClear();
    expect(await editor().addMarauderBases(1)).toBe(true);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
