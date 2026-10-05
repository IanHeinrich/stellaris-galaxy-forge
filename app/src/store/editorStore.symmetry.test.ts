import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT } from "./fixture";
import { mockedIpc } from "../test/ipc";
import {
  FIRST_FREE,
  MIRROR_X,
  PLACED,
  QUARTER,
  added,
  link,
  openPlaced,
  sent,
  sym,
} from "./symmetryFixture";

beforeEach(openPlaced);

describe("with symmetry off", () => {
  it("sends every single edit as it was asked for", async () => {
    await editor().addSystemAt(150, 60);
    expect(sent()).toEqual({
      type: "AddSystem",
      system: null,
      x: 150,
      y: 60,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    await editor().setSelection([10], "replace");
    await editor().nudgeSelection(5, 3);
    expect(sent()).toEqual({ type: "MoveSystem", system: 10, x: 105, y: 53 });
    await editor().applySymmetric({ type: "AddLane", a: 10, b: 12, bridge: false });
    expect(sent()).toEqual({ type: "AddLane", a: 10, b: 12, bridge: false });
    await editor().removeSystems([10]);
    expect(sent()).toEqual({ type: "RemoveSystem", system: 10 });
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
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await useFileSessionStore.getState().openScenario(SCENARIO_RESULT.path, "paint_a_galaxy");
    useGalaxyStore.getState().applyDelta({ systems: PLACED });
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
    await editor().setSelection([10], "replace");
    await editor().nudgeSelection(5, 3);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Moved 2 systems",
      ops: [
        {
          type: "MoveSystems",
          moves: [
            { system: 10, x: 105, y: 53 },
            { system: 11, x: 105, y: -53 },
          ],
        },
      ],
    });

    sym(QUARTER);
    await editor().applySymmetric({ type: "MoveSystem", system: 20, x: 310, y: 100 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Moved 4 systems",
      ops: [
        {
          type: "MoveSystems",
          moves: [
            { system: 20, x: 310, y: 100 },
            { system: 21, x: -100, y: 310 },
            { system: 22, x: -310, y: -100 },
            { system: 23, x: 100, y: -310 },
          ],
        },
      ],
    });
  });

  it("moves a counterpart already moving once, and a system on the axis or alone by itself", async () => {
    sym(MIRROR_X);
    await editor().setSelection([10, 11], "replace");
    await editor().nudgeSelection(5, 0);
    expect(sent()).toEqual({
      type: "MoveSystems",
      moves: [
        { system: 10, x: 105, y: 50 },
        { system: 11, x: 105, y: -50 },
      ],
    });
    await editor().setSelection([12], "replace");
    await editor().nudgeSelection(0, 5);
    expect(sent()).toEqual({ type: "MoveSystem", system: 12, x: 200, y: 5 });
    await editor().setSelection([13], "replace");
    await editor().nudgeSelection(1, 1);
    expect(sent()).toEqual({ type: "MoveSystem", system: 13, x: 151, y: 81 });
  });

  it("moves a selection holding its own quarter turn as one symmetric shape", async () => {
    sym(QUARTER);
    await editor().setSelection([20, 21], "replace");
    await editor().nudgeSelection(10, 5);
    const moves = [
      { system: 20, x: 310, y: 105 },
      { system: 21, x: -105, y: 310 },
      { system: 22, x: -310, y: -105 },
      { system: 23, x: 105, y: -310 },
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
          return { system: id, x: s.x + 10, y: s.y + 5 };
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
});

describe("deleting systems under symmetry", () => {
  it("deletes the counterparts too, counting them in the question", async () => {
    sym(QUARTER);
    link([20, 0]);
    await editor().removeSystems([20]);
    expect(mockedIpc.confirm).toHaveBeenCalledWith("Delete 4 systems and their 1 lane?", {
      title: "Delete systems",
      kind: "warning",
    });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Deleted 4 systems",
      ops: [{ type: "RemoveSystems", systems: [20, 21, 22, 23] }],
    });

    sym(MIRROR_X);
    await editor().removeSystems([10, 13]);
    expect(sent()).toEqual({
      type: "Batch",
      description: "Deleted 3 systems",
      ops: [{ type: "RemoveSystems", systems: [10, 13, 11] }],
    });
  });

  it("deletes a system with no counterpart as before", async () => {
    sym(MIRROR_X);
    await editor().removeSystems([13]);
    expect(mockedIpc.confirm).toHaveBeenCalledWith("Delete Lone?", expect.anything());
    expect(sent()).toEqual({ type: "RemoveSystem", system: 13 });
  });
});
