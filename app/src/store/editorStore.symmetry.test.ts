import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { NewSystem } from "../generated/NewSystem";
import type { SpawnScript } from "../generated/SpawnScript";
import type { Symmetry } from "../lib/geometry/symmetry";
import { scriptForKind, weightedScript } from "../lib/paint";
import { editor, mocked, openFixtureSave } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT, editResult, lanesTo, node } from "./fixture";
import { useToolStore } from "./toolStore";

const MIRROR_X: Symmetry = { kind: "mirror", axis: "x" };
const QUARTER: Symmetry = { kind: "rotate", n: 4 };

/**
 * Beside the fixture, whose Sol sits at the centre and Alpha Centauri and Sirius on the x axis:
 * 10 and 11 mirror each other across it, 12 sits on it, and nothing mirrors 13. 20 to 23 are
 * one system's four quarter turns.
 */
const PLACED = [
  node(10, "NAME_Upper", 100, 50, "sc_g", [], { initializer: "" }),
  node(11, "NAME_Lower", 100, -50, "sc_g", [], { initializer: "" }),
  node(12, "NAME_Axis", 200, 0, "sc_g", [], { initializer: "" }),
  node(13, "NAME_Lone", 150, 80, "sc_g", [], { initializer: "" }),
  node(20, "NAME_East", 300, 100, "sc_g", [], { initializer: "" }),
  node(21, "NAME_North", -100, 300, "sc_g", [], { initializer: "" }),
  node(22, "NAME_West", -300, -100, "sc_g", [], { initializer: "" }),
  node(23, "NAME_South", 100, -300, "sc_g", [], { initializer: "" }),
];
const FIRST_FREE = 24;

/** Links each pair both ways, over the placed systems as they stand. */
function link(...pairs: Array<[number, number]>): void {
  const all = useGalaxyStore.getState().systems;
  const touched = new Map<number, (typeof PLACED)[number]>();
  for (const [a, b] of pairs) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const s = touched.get(from) ?? all.get(from)!;
      touched.set(from, { ...s, lanes: [...s.lanes, ...lanesTo(to)] });
    }
  }
  useGalaxyStore.getState().applyDelta({ systems: [...touched.values()] });
}

function sym(symmetry: Symmetry): void {
  useToolStore.setState({ symmetry });
}

const sent = () => mocked.applyOp.mock.calls[mocked.applyOp.mock.calls.length - 1][0];

function seat(kind: "enabled" | "preferred" | "sol", random_value: number, player = false) {
  return { paint_a_galaxy: { kind, random_value, player } };
}

/** Seats on 20, 21 and 23 of one quarter-turn orbit, and none on 22. */
function placeSeats(): void {
  const all = useGalaxyStore.getState().systems;
  const seated = (id: number, script: SpawnScript) => ({ ...all.get(id)!, spawn_script: script });
  useGalaxyStore.getState().applyDelta({
    systems: [
      seated(20, seat("preferred", 3)),
      seated(21, seat("sol", 7)),
      seated(23, seat("enabled", 5)),
    ],
  });
}

function added(id: number, x: number, y: number, extra: Partial<NewSystem> = {}): NewSystem {
  return {
    id,
    x,
    y,
    name: null,
    initializer: null,
    spawn_weight: null,
    spawn_script: null,
    ...extra,
  };
}

beforeEach(async () => {
  await openFixtureSave();
  mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
  await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  mocked.applyOp.mockResolvedValue(editResult());
  useGalaxyStore.getState().applyDelta({ systems: PLACED });
  useToolStore.setState({ symmetry: { kind: "off" } });
});

describe("with symmetry off", () => {
  it("sends every single edit as it was asked for", async () => {
    await editor().addSystemAt(150, 60);
    expect(sent()).toEqual({
      type: "AddSystem",
      id: null,
      x: 150,
      y: 60,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    useEditorStore.setState({ selection: [10] });
    await editor().nudgeSelection(5, 3);
    expect(sent()).toEqual({ type: "MoveSystem", id: 10, x: 105, y: 53 });
    await editor().applySymmetric({ type: "AddLane", a: 10, b: 12, bridge: false });
    expect(sent()).toEqual({ type: "AddLane", a: 10, b: 12, bridge: false });
    await editor().removeSystems([10]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Deleted 1 system",
      ops: [{ type: "RemoveSystems", ids: [10] }],
    });
  });
});

describe("adding a system under symmetry", () => {
  it("adds one at each image, carrying the same initializer and spawn weight, as one edit", async () => {
    sym(MIRROR_X);
    await editor().addSystemAt(150, 60, "init_twin", 1);
    const carried = { initializer: "init_twin", spawn_weight: 1 };
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 2 systems",
      ops: [
        {
          type: "AddSystems",
          systems: [added(FIRST_FREE, 150, 60, carried), added(FIRST_FREE + 1, 150, -60, carried)],
        },
      ],
    });

    sym(QUARTER);
    await editor().addSystemAt(200, 100);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 4 systems",
      ops: [
        {
          type: "AddSystems",
          systems: [
            added(FIRST_FREE, 200, 100),
            added(FIRST_FREE + 1, -100, 200),
            added(FIRST_FREE + 2, -200, -100),
            added(FIRST_FREE + 3, 100, -200),
          ],
        },
      ],
    });
  });

  it("adds one system alone where its images would land on it, on the axis or at the centre", async () => {
    sym(MIRROR_X);
    await editor().addSystemAt(150, 0.2);
    expect(sent()).toMatchObject({ type: "AddSystem", x: 150, y: 0.2 });
    sym(QUARTER);
    await editor().addSystemAt(0.1, 0.1);
    expect(sent()).toMatchObject({ type: "AddSystem", x: 0.1, y: 0.1 });
  });

  it("adds no copy where a system already stands, so a missing partner is added alone", async () => {
    sym(MIRROR_X);
    await editor().addSystemAt(150, -80);
    expect(sent()).toMatchObject({ type: "AddSystem", x: 150, y: -80 });

    sym(QUARTER);
    await editor().addSystemAt(-80, 150);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 3 systems",
      ops: [
        {
          type: "AddSystems",
          systems: [
            added(FIRST_FREE, -80, 150),
            added(FIRST_FREE + 1, -150, -80),
            added(FIRST_FREE + 2, 80, -150),
          ],
        },
      ],
    });
  });

  it("gives each Paint a Galaxy copy a seat of its own id", async () => {
    useFileSessionStore.setState({ paintChosen: true });
    sym(MIRROR_X);
    await editor().addSystemAt(150, 60, "init_twin", 1);
    const seat = (random_value: number) => ({
      initializer: "init_twin",
      spawn_script: { paint_a_galaxy: { kind: "enabled" as const, random_value, player: false } },
    });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 2 systems",
      ops: [
        {
          type: "AddSystems",
          systems: [
            added(FIRST_FREE, 150, 60, seat(FIRST_FREE % 10)),
            added(FIRST_FREE + 1, 150, -60, seat((FIRST_FREE + 1) % 10)),
          ],
        },
      ],
    });
  });
});

describe("moving systems under symmetry", () => {
  it("moves each counterpart by the image of the move, as one edit", async () => {
    sym(MIRROR_X);
    useEditorStore.setState({ selection: [10] });
    await editor().nudgeSelection(5, 3);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Moved 2 systems",
      ops: [
        {
          type: "MoveSystems",
          moves: [
            { id: 10, x: 105, y: 53 },
            { id: 11, x: 105, y: -53 },
          ],
        },
      ],
    });

    sym(QUARTER);
    await editor().applySymmetric({ type: "MoveSystem", id: 20, x: 310, y: 100 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Moved 4 systems",
      ops: [
        {
          type: "MoveSystems",
          moves: [
            { id: 20, x: 310, y: 100 },
            { id: 21, x: -100, y: 310 },
            { id: 22, x: -310, y: -100 },
            { id: 23, x: 100, y: -310 },
          ],
        },
      ],
    });
  });

  it("moves a counterpart already moving once, and a system on the axis or alone by itself", async () => {
    sym(MIRROR_X);
    useEditorStore.setState({ selection: [10, 11] });
    await editor().nudgeSelection(5, 0);
    expect(sent()).toEqual({
      type: "MoveSystems",
      moves: [
        { id: 10, x: 105, y: 50 },
        { id: 11, x: 105, y: -50 },
      ],
    });
    useEditorStore.setState({ selection: [12] });
    await editor().nudgeSelection(0, 5);
    expect(sent()).toEqual({ type: "MoveSystem", id: 12, x: 200, y: 5 });
    useEditorStore.setState({ selection: [13] });
    await editor().nudgeSelection(1, 1);
    expect(sent()).toEqual({ type: "MoveSystem", id: 13, x: 151, y: 81 });
  });

  it("moves a selection holding its own quarter turn as one symmetric shape", async () => {
    sym(QUARTER);
    useEditorStore.setState({ selection: [20, 21] });
    await editor().nudgeSelection(10, 5);
    const moves = [
      { id: 20, x: 310, y: 105 },
      { id: 21, x: -105, y: 310 },
      { id: 22, x: -310, y: -105 },
      { id: 23, x: 105, y: -310 },
    ];
    expect(sent()).toEqual({
      type: "Batch",
      description: "Moved 4 systems",
      ops: [{ type: "MoveSystems", moves }],
    });

    const dragged = (order: number[]) =>
      editor().applySymmetric({
        type: "MoveSystems",
        moves: order.map((id) => {
          const s = useGalaxyStore.getState().systems.get(id)!;
          return { id, x: s.x + 10, y: s.y + 5 };
        }),
      });
    await dragged([20, 21, 22]);
    const first = sent();
    await dragged([20, 22, 21]);
    expect(sent()).toEqual(first);
    expect(first).toEqual({
      type: "Batch",
      description: "Moved 4 systems",
      ops: [{ type: "MoveSystems", moves }],
    });
  });

  it("moves a selection straddling the mirror axis as its mirror image", async () => {
    sym(MIRROR_X);
    useEditorStore.setState({ selection: [10, 11] });
    await editor().nudgeSelection(5, 3);
    expect(sent()).toEqual({
      type: "MoveSystems",
      moves: [
        { id: 10, x: 105, y: 53 },
        { id: 11, x: 105, y: -53 },
      ],
    });
  });
});

describe("adding lanes under symmetry", () => {
  it("adds the image lane between the ends' counterparts, as one edit", async () => {
    sym(MIRROR_X);
    await editor().applySymmetric({ type: "AddLane", a: 10, b: 12, bridge: false });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 2 lanes",
      ops: [
        {
          type: "AddLanePairs",
          lanes: [
            { a: 10, b: 12, bridge: false },
            { a: 11, b: 12, bridge: false },
          ],
        },
      ],
    });

    sym(QUARTER);
    useEditorStore.setState({ selection: [20, 0] });
    await editor().connectSelected();
    expect(sent()).toEqual({
      type: "Batch",
      description: "Added 4 lanes",
      ops: [
        {
          type: "AddLanePairs",
          lanes: [
            { a: 0, b: 20, bridge: false },
            { a: 0, b: 21, bridge: false },
            { a: 0, b: 22, bridge: false },
            { a: 0, b: 23, bridge: false },
          ],
        },
      ],
    });
  });

  it("adds no image lane already there, barred, or to a system the image lacks", async () => {
    sym(MIRROR_X);
    link([11, 12]);
    await editor().applySymmetric({ type: "AddLane", a: 10, b: 12, bridge: false });
    expect(sent()).toEqual({ type: "AddLane", a: 10, b: 12, bridge: false });

    const lower = useGalaxyStore.getState().systems.get(11)!;
    useGalaxyStore.getState().applyDelta({ systems: [{ ...lower, lanes: [], prevented: [12] }] });
    await editor().applySymmetric({ type: "AddLane", a: 10, b: 12, bridge: false });
    expect(sent()).toEqual({ type: "AddLane", a: 10, b: 12, bridge: false });

    await editor().applySymmetric({ type: "AddLane", a: 13, b: 12, bridge: false });
    expect(sent()).toEqual({ type: "AddLane", a: 13, b: 12, bridge: false });
  });
});

describe("cutting lanes under symmetry", () => {
  it("cuts the image lanes that exist, as one edit", async () => {
    sym(MIRROR_X);
    link([10, 12], [11, 12]);
    await editor().applySymmetric({ type: "RemoveLane", a: 10, b: 12 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut 2 lanes",
      ops: [
        {
          type: "RemoveLanePairs",
          lanes: [
            [10, 12],
            [11, 12],
          ],
        },
      ],
    });
  });

  it("cuts a lane alone when its image is not there", async () => {
    sym(MIRROR_X);
    link([10, 12]);
    await editor().applySymmetric({ type: "RemoveLane", a: 10, b: 12 });
    expect(sent()).toEqual({ type: "RemoveLane", a: 10, b: 12 });
  });
});

describe("preventing and allowing lanes", () => {
  /** Has the scenario keep each pair from a lane, named on both ends. */
  function bar(...pairs: Array<[number, number]>): void {
    const all = useGalaxyStore.getState().systems;
    const touched = new Map<number, (typeof PLACED)[number]>();
    for (const [a, b] of pairs) {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const s = touched.get(from) ?? all.get(from)!;
        touched.set(from, { ...s, prevented: [...s.prevented, to] });
      }
    }
    useGalaxyStore.getState().applyDelta({ systems: [...touched.values()] });
  }

  it("cuts a lane and prevents it as one edit, and prevents a pair with no lane alone", async () => {
    link([10, 12]);
    await editor().preventLanes([[10, 12]]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut and prevented lane 10 <-> 12",
      ops: [
        { type: "RemoveLane", a: 10, b: 12 },
        { type: "PreventLane", a: 10, b: 12 },
      ],
    });

    await editor().preventLanes([[13, 12]]);
    expect(sent()).toEqual({ type: "PreventLane", a: 13, b: 12 });
  });

  it("only cuts a lane the scenario already prevents", async () => {
    link([10, 12]);
    bar([10, 12]);
    await editor().preventLanes([[10, 12]]);
    expect(sent()).toEqual({ type: "RemoveLane", a: 10, b: 12 });
  });

  it("prevents lanes to the selected systems not kept from the target yet, and allows the ones that are", async () => {
    link([10, 12]);
    bar([11, 12]);
    useEditorStore.setState({ selection: [10, 11, 13] });

    await editor().preventLanesToSelected(12);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut 1 lane and prevented 2 lanes",
      ops: [
        { type: "RemoveLane", a: 10, b: 12 },
        { type: "PreventLane", a: 10, b: 12 },
        { type: "PreventLane", a: 12, b: 13 },
      ],
    });

    await editor().allowLanesToSelected(12);
    expect(sent()).toEqual({ type: "UnpreventLane", a: 11, b: 12 });
  });

  it("does the same to each counterpart pair under symmetry, as one edit", async () => {
    sym(MIRROR_X);
    link([10, 12], [11, 12]);
    await editor().preventLanes([[10, 12]]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Cut 2 lanes and prevented 2 lanes",
      ops: [
        {
          type: "RemoveLanePairs",
          lanes: [
            [10, 12],
            [11, 12],
          ],
        },
        { type: "PreventLane", a: 10, b: 12 },
        { type: "PreventLane", a: 11, b: 12 },
      ],
    });

    bar([10, 12], [11, 12]);
    await editor().applySymmetric({ type: "UnpreventLane", a: 12, b: 11 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Allowed 2 lanes",
      ops: [
        { type: "UnpreventLane", a: 12, b: 11 },
        { type: "UnpreventLane", a: 12, b: 10 },
      ],
    });
  });

  it("leaves out a counterpart the core would refuse: already prevented, joined by a lane, or not prevented", async () => {
    sym(MIRROR_X);
    bar([11, 12]);
    await editor().preventLanes([[10, 12]]);
    expect(sent()).toEqual({ type: "PreventLane", a: 10, b: 12 });

    await editor().applySymmetric({ type: "UnpreventLane", a: 11, b: 12 });
    expect(sent()).toEqual({ type: "UnpreventLane", a: 11, b: 12 });

    sym(QUARTER);
    link([20, 0]);
    await editor().applySymmetric({ type: "PreventLane", a: 21, b: 0 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Prevented 3 lanes",
      ops: [
        { type: "PreventLane", a: 21, b: 0 },
        { type: "PreventLane", a: 22, b: 0 },
        { type: "PreventLane", a: 23, b: 0 },
      ],
    });
  });
});

describe("isolating systems under symmetry", () => {
  it("isolates the counterparts that have lanes, as one edit", async () => {
    sym(MIRROR_X);
    link([10, 12], [11, 12]);
    useEditorStore.setState({ selection: [10] });
    await editor().isolateSelected();
    expect(sent()).toEqual({
      type: "Batch",
      description: "Isolated 2 systems",
      ops: [{ type: "IsolateSystems", ids: [10, 11] }],
    });
  });

  it("isolates a system alone when its counterparts have no lanes", async () => {
    sym(QUARTER);
    link([20, 0]);
    await editor().applySymmetric({ type: "IsolateSystem", id: 20 });
    expect(sent()).toEqual({ type: "IsolateSystem", id: 20 });
  });
});

describe("deleting systems under symmetry", () => {
  it("deletes the counterparts too, counting them in the question", async () => {
    sym(QUARTER);
    link([20, 0]);
    await editor().removeSystem(20);
    expect(mocked.confirm).toHaveBeenCalledWith("Delete 4 systems and their 1 lane?", {
      title: "Delete systems",
      kind: "warning",
    });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Deleted 4 systems",
      ops: [{ type: "RemoveSystems", ids: [20, 21, 22, 23] }],
    });

    sym(MIRROR_X);
    await editor().removeSystems([10, 13]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Deleted 3 systems",
      ops: [{ type: "RemoveSystems", ids: [10, 13, 11] }],
    });
  });

  it("deletes a system with no counterpart as before", async () => {
    sym(MIRROR_X);
    await editor().removeSystem(13);
    expect(mocked.confirm).toHaveBeenCalledWith("Delete Lone?", expect.anything());
    expect(sent()).toEqual({ type: "RemoveSystem", id: 13 });
  });
});

describe("initializers and spawns under symmetry", () => {
  it("set the same initializer, weight or seat on every counterpart, as one edit", async () => {
    sym(MIRROR_X);
    await editor().applySymmetric({ type: "SetInitializer", id: 10, initializer: "init_twin" });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the initializer of 2 systems",
      ops: [
        {
          type: "SetInitializers",
          entries: [
            { id: 10, initializer: "init_twin" },
            { id: 11, initializer: "init_twin" },
          ],
        },
      ],
    });

    sym(QUARTER);
    await editor().applySymmetric({ type: "SetSpawnWeight", id: 21, base: null });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the spawn weight of 4 systems",
      ops: [
        {
          type: "SetSpawnWeights",
          entries: [
            [21, null],
            [22, null],
            [23, null],
            [20, null],
          ],
        },
      ],
    });

    await editor().applySymmetric({ type: "SetSpawnScripts", entries: [[20, seat("enabled", 4)]] });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the seat of 4 systems",
      ops: [
        {
          type: "SetSpawnScripts",
          entries: [
            [20, seat("enabled", 4)],
            [21, seat("enabled", 1)],
            [22, seat("enabled", 2)],
            [23, seat("enabled", 3)],
          ],
        },
      ],
    });
  });

  it("make each counterpart's seat from that counterpart", async () => {
    sym(QUARTER);
    placeSeats();
    await editor().setSeat(20, (s) =>
      s.spawn_script?.paint_a_galaxy.kind === "enabled" ? undefined : weightedScript(s, true),
    );
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the seat of 3 systems",
      ops: [
        {
          type: "SetSpawnScripts",
          entries: [
            [20, seat("preferred", 3, true)],
            [21, seat("sol", 7, true)],
            [22, seat("enabled", 2, true)],
          ],
        },
      ],
    });

    await editor().setSeat(21, (s) => scriptForKind("preferred", s));
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the seat of 4 systems",
      ops: [
        {
          type: "SetSpawnScripts",
          entries: [
            [21, seat("preferred", 7)],
            [22, seat("preferred", 2)],
            [23, seat("preferred", 5)],
            [20, seat("preferred", 3)],
          ],
        },
      ],
    });
  });

  it("set a Sol seat or one reserved for an empire on the system edited alone", async () => {
    sym(QUARTER);
    placeSeats();
    await editor().setSeat(20, (s) => scriptForKind("reserved:a", s));
    const reserved: SpawnScript = {
      paint_a_galaxy: { kind: { reserved: "a" }, random_value: 3, player: false },
    };
    expect(sent()).toEqual({ type: "SetSpawnScript", id: 20, script: reserved });

    await editor().applySymmetric({ type: "SetSpawnScript", id: 21, script: reserved });
    expect(sent()).toEqual({ type: "SetSpawnScript", id: 21, script: reserved });

    const sol: SpawnScript = { paint_a_galaxy: { kind: "sol", random_value: 3, player: false } };
    await editor().applySymmetric({ type: "SetSpawnScript", id: 21, script: sol });
    expect(sent()).toEqual({ type: "SetSpawnScript", id: 21, script: sol });
  });

  it("set a system with no counterpart alone", async () => {
    sym(MIRROR_X);
    await editor().applySymmetric({ type: "SetInitializer", id: 13, initializer: "init_twin" });
    expect(sent()).toEqual({ type: "SetInitializer", id: 13, initializer: "init_twin" });
  });
});
