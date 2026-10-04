import { describe, expect, it } from "vitest";
import { byId, node } from "../store/fixture";
import { spawnPointOp, spawnPointsOp, spawnTargets } from "./spawnPoint";

/** A system the generator can weigh, and one it cannot: a weight needs an initializer beside it. */
const weighable = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g");
const plain = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g", [], { initializer: "" });

describe("weighing a selection", () => {
  it("writes one entry per system that can carry a weight, as a single op", () => {
    const map = byId(weighable(0), plain(1), weighable(2));

    expect(spawnTargets([0, 1, 2], map, false).map((s) => s.id)).toEqual([0, 2]);
    expect(spawnPointsOp([0, 1, 2], map, true, false)).toEqual({
      type: "Batch",
      description: "Set the spawn weight of 2 systems",
      ops: [
        { type: "SetSpawnWeight", system: 0, base: 1 },
        { type: "SetSpawnWeight", system: 2, base: 1 },
      ],
    });
    expect(spawnPointsOp([0, 1, 2], map, false, false)).toEqual({
      type: "Batch",
      description: "Set the spawn weight of 2 systems",
      ops: [
        { type: "SetSpawnWeight", system: 0, base: null },
        { type: "SetSpawnWeight", system: 2, base: null },
      ],
    });
  });

  it("keeps the single-system op, whose description names the system", () => {
    const map = byId(weighable(0), plain(1));

    expect(spawnPointsOp([0, 1], map, true, false)).toEqual({
      type: "SetSpawnWeight",
      system: 0,
      base: 1,
    });
  });

  it("writes nothing when no system in the selection can carry a weight", () => {
    const map = byId(weighable(0), plain(1));

    expect(spawnPointsOp([1], map, true, false)).toBeNull();
    expect(spawnPointsOp([99], map, true, false)).toBeNull();
    expect(spawnPointsOp([], map, false, false)).toBeNull();
    expect(spawnPointsOp([99], map, true, true)).toBeNull();
  });

  it("under the Paint a Galaxy profile takes a system without an initializer, which the script's op supplies", () => {
    const map = byId(weighable(0), plain(1));

    expect(spawnTargets([0, 1], map, true).map((s) => s.id)).toEqual([0, 1]);
    expect(spawnPointsOp([1], map, true, true)).toEqual({
      type: "SetSpawnScript",
      system: 1,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 1, player: false } },
    });
    expect(spawnPointsOp([0, 1], map, true, true)).toEqual({
      type: "Batch",
      description: "Set the scripted spawn of 2 systems",
      ops: [
        {
          type: "SetSpawnScript",
          system: 0,
          script: { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } },
        },
        {
          type: "SetSpawnScript",
          system: 1,
          script: { paint_a_galaxy: { kind: "enabled", random_value: 1, player: false } },
        },
      ],
    });
    expect(spawnPointsOp([1], map, true, false)).toBeNull();
  });

  it("under the Paint a Galaxy profile keeps the seat a system already has", () => {
    const preferred = {
      paint_a_galaxy: { kind: "preferred" as const, random_value: 7, player: false },
    };
    const seated = { ...weighable(3), spawn_weight: 0, spawn_script: preferred };
    const map = byId(seated, weighable(0));

    expect(spawnPointsOp([3, 0], map, true, true)).toEqual({
      type: "Batch",
      description: "Set the scripted spawn of 2 systems",
      ops: [
        { type: "SetSpawnScript", system: 3, script: preferred },
        {
          type: "SetSpawnScript",
          system: 0,
          script: { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } },
        },
      ],
    });
    expect(spawnPointOp(seated, 1, true)).toEqual({
      type: "SetSpawnScript",
      system: 3,
      script: preferred,
    });
  });

  it("under the Paint a Galaxy profile marks the seat with the site's script instead", () => {
    const map = byId(weighable(0), plain(1), weighable(12));

    expect(spawnPointOp(weighable(12), 1, true)).toEqual({
      type: "SetSpawnScript",
      system: 12,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 2, player: false } },
    });
    expect(spawnPointOp(weighable(12), null, true)).toEqual({
      type: "SetSpawnScript",
      system: 12,
      script: null,
    });
    expect(spawnPointOp(weighable(12), 1, false)).toEqual({
      type: "SetSpawnWeight",
      system: 12,
      base: 1,
    });
    expect(spawnPointsOp([0, 12], map, true, true)).toEqual({
      type: "Batch",
      description: "Set the scripted spawn of 2 systems",
      ops: [
        {
          type: "SetSpawnScript",
          system: 0,
          script: { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } },
        },
        {
          type: "SetSpawnScript",
          system: 12,
          script: { paint_a_galaxy: { kind: "enabled", random_value: 2, player: false } },
        },
      ],
    });
    expect(spawnPointsOp([0, 12], map, false, true)).toEqual({
      type: "Batch",
      description: "Set the scripted spawn of 2 systems",
      ops: [
        { type: "SetSpawnScript", system: 0, script: null },
        { type: "SetSpawnScript", system: 12, script: null },
      ],
    });
    expect(spawnPointsOp([0], map, true, true)).toEqual({
      type: "SetSpawnScript",
      system: 0,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } },
    });
  });
});
