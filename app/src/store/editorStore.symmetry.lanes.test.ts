import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { SpawnScript } from "../generated/SpawnScript";
import { scriptForKind, weightedScript } from "../lib/paint";
import { editor } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import {
  MIRROR_X,
  QUARTER,
  bar,
  link,
  openPlaced,
  placeSeats,
  seat,
  sent,
  sym,
} from "./symmetryFixture";

beforeEach(openPlaced);

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
    await editor().setSelection([20, 0], "replace");
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

describe("preventing and allowing lanes under symmetry", () => {
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
    await editor().applySymmetric({ type: "AllowLane", a: 12, b: 11 });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Allowed 2 lanes",
      ops: [
        { type: "AllowLane", a: 12, b: 11 },
        { type: "AllowLane", a: 12, b: 10 },
      ],
    });
  });

  it("leaves out a counterpart the core would refuse: already prevented, joined by a lane, or not prevented", async () => {
    sym(MIRROR_X);
    bar([11, 12]);
    await editor().preventLanes([[10, 12]]);
    expect(sent()).toEqual({ type: "PreventLane", a: 10, b: 12 });

    await editor().applySymmetric({ type: "AllowLane", a: 11, b: 12 });
    expect(sent()).toEqual({ type: "AllowLane", a: 11, b: 12 });

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
    await editor().setSelection([10], "replace");
    await editor().isolateSelected();
    expect(sent()).toEqual({
      type: "Batch",
      description: "Isolated 2 systems",
      ops: [{ type: "IsolateSystems", systems: [10, 11] }],
    });
  });

  it("isolates a system alone when its counterparts have no lanes", async () => {
    sym(QUARTER);
    link([20, 0]);
    await editor().applySymmetric({ type: "IsolateSystem", system: 20 });
    expect(sent()).toEqual({ type: "IsolateSystem", system: 20 });
  });
});

describe("initializers and spawns under symmetry", () => {
  it("set the same initializer, weight or seat on every counterpart, as one edit", async () => {
    sym(MIRROR_X);
    await editor().applySymmetric({ type: "SetInitializer", system: 10, initializer: "init_twin" });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the initializer of 2 systems",
      ops: [
        { type: "SetInitializer", system: 10, initializer: "init_twin" },
        { type: "SetInitializer", system: 11, initializer: "init_twin" },
      ],
    });

    sym(QUARTER);
    await editor().applySymmetric({ type: "SetSpawnWeight", system: 21, base: null });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the spawn weight of 4 systems",
      ops: [
        { type: "SetSpawnWeight", system: 21, base: null },
        { type: "SetSpawnWeight", system: 22, base: null },
        { type: "SetSpawnWeight", system: 23, base: null },
        { type: "SetSpawnWeight", system: 20, base: null },
      ],
    });

    await editor().applySymmetric({
      type: "Batch",
      description: "Set the scripted spawn of 2 systems",
      ops: [
        { type: "SetSpawnScript", system: 20, script: seat("enabled", 4) },
        { type: "SetSpawnScript", system: 21, script: seat("enabled", 1) },
      ],
    });
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the seat of 4 systems",
      ops: [
        { type: "SetSpawnScript", system: 20, script: seat("enabled", 4) },
        { type: "SetSpawnScript", system: 21, script: seat("enabled", 1) },
        { type: "SetSpawnScript", system: 22, script: seat("enabled", 2) },
        { type: "SetSpawnScript", system: 23, script: seat("enabled", 3) },
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
        { type: "SetSpawnScript", system: 20, script: seat("preferred", 3, true) },
        { type: "SetSpawnScript", system: 21, script: seat("sol", 7, true) },
        { type: "SetSpawnScript", system: 22, script: seat("enabled", 2, true) },
      ],
    });

    await editor().setSeat(21, (s) => scriptForKind("preferred", s));
    expect(sent()).toEqual({
      type: "Batch",
      description: "Set the seat of 4 systems",
      ops: [
        { type: "SetSpawnScript", system: 21, script: seat("preferred", 7) },
        { type: "SetSpawnScript", system: 22, script: seat("preferred", 2) },
        { type: "SetSpawnScript", system: 23, script: seat("preferred", 5) },
        { type: "SetSpawnScript", system: 20, script: seat("preferred", 3) },
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
    expect(sent()).toEqual({ type: "SetSpawnScript", system: 20, script: reserved });

    await editor().applySymmetric({ type: "SetSpawnScript", system: 21, script: reserved });
    expect(sent()).toEqual({ type: "SetSpawnScript", system: 21, script: reserved });

    const sol: SpawnScript = { paint_a_galaxy: { kind: "sol", random_value: 3, player: false } };
    await editor().applySymmetric({ type: "SetSpawnScript", system: 21, script: sol });
    expect(sent()).toEqual({ type: "SetSpawnScript", system: 21, script: sol });
  });

  it("set a system with no counterpart alone", async () => {
    sym(MIRROR_X);
    await editor().applySymmetric({ type: "SetInitializer", system: 13, initializer: "init_twin" });
    expect(sent()).toEqual({ type: "SetInitializer", system: 13, initializer: "init_twin" });
  });
});
