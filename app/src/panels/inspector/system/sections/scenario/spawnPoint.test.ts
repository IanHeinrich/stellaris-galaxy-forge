import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../../../../generated/SystemNode";
import { node } from "../../../../../store/fixture";
import { spawnPointOp, spawnPointsOp, spawnTargets } from "./spawnPoint";

/** A system the generator can weigh, and one it cannot: a weight needs an initializer beside it. */
const weighable = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g");
const plain = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g", [], { initializer: "" });

function systems(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

describe("weighing a selection", () => {
  it("writes one entry per system that can carry a weight, as a single op", () => {
    const map = systems(weighable(0), plain(1), weighable(2));

    expect(spawnTargets([0, 1, 2], map, false).map((s) => s.id)).toEqual([0, 2]);
    expect(spawnPointsOp([0, 1, 2], map, true, false)).toEqual({
      type: "SetSpawnWeights",
      entries: [
        [0, 1],
        [2, 1],
      ],
    });
    expect(spawnPointsOp([0, 1, 2], map, false, false)).toEqual({
      type: "SetSpawnWeights",
      entries: [
        [0, null],
        [2, null],
      ],
    });
  });

  it("keeps the single-system op, whose description names the system", () => {
    const map = systems(weighable(0), plain(1));

    expect(spawnPointsOp([0, 1], map, true, false)).toEqual({
      type: "SetSpawnWeight",
      id: 0,
      base: 1,
    });
  });

  it("writes nothing when no system in the selection can carry a weight", () => {
    const map = systems(weighable(0), plain(1));

    expect(spawnPointsOp([1], map, true, false)).toBeNull();
    expect(spawnPointsOp([99], map, true, false)).toBeNull();
    expect(spawnPointsOp([], map, false, false)).toBeNull();
    expect(spawnPointsOp([99], map, true, true)).toBeNull();
  });

  it("under the Paint a Galaxy profile takes a system without an initializer, which the script's op supplies", () => {
    const map = systems(weighable(0), plain(1));

    expect(spawnTargets([0, 1], map, true).map((s) => s.id)).toEqual([0, 1]);
    expect(spawnPointsOp([1], map, true, true)).toEqual({
      type: "SetSpawnScript",
      id: 1,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 1, player: false } },
    });
    expect(spawnPointsOp([0, 1], map, true, true)).toEqual({
      type: "SetSpawnScripts",
      entries: [
        [0, { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } }],
        [1, { paint_a_galaxy: { kind: "enabled", random_value: 1, player: false } }],
      ],
    });
    expect(spawnPointsOp([1], map, true, false)).toBeNull();
  });

  it("under the Paint a Galaxy profile keeps the seat a system already has", () => {
    const preferred = {
      paint_a_galaxy: { kind: "preferred" as const, random_value: 7, player: false },
    };
    const seated = { ...weighable(3), spawn_weight: 0, spawn_script: preferred };
    const map = systems(seated, weighable(0));

    expect(spawnPointsOp([3, 0], map, true, true)).toEqual({
      type: "SetSpawnScripts",
      entries: [
        [3, preferred],
        [0, { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } }],
      ],
    });
    expect(spawnPointOp(seated, 1, true)).toEqual({
      type: "SetSpawnScript",
      id: 3,
      script: preferred,
    });
  });

  it("under the Paint a Galaxy profile marks the seat with the site's script instead", () => {
    const map = systems(weighable(0), plain(1), weighable(12));

    expect(spawnPointOp(weighable(12), 1, true)).toEqual({
      type: "SetSpawnScript",
      id: 12,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 2, player: false } },
    });
    expect(spawnPointOp(weighable(12), null, true)).toEqual({
      type: "SetSpawnScript",
      id: 12,
      script: null,
    });
    expect(spawnPointOp(weighable(12), 1, false)).toEqual({
      type: "SetSpawnWeight",
      id: 12,
      base: 1,
    });
    expect(spawnPointsOp([0, 12], map, true, true)).toEqual({
      type: "SetSpawnScripts",
      entries: [
        [0, { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } }],
        [12, { paint_a_galaxy: { kind: "enabled", random_value: 2, player: false } }],
      ],
    });
    expect(spawnPointsOp([0, 12], map, false, true)).toEqual({
      type: "SetSpawnScripts",
      entries: [
        [0, null],
        [12, null],
      ],
    });
    expect(spawnPointsOp([0], map, true, true)).toEqual({
      type: "SetSpawnScript",
      id: 0,
      script: { paint_a_galaxy: { kind: "enabled", random_value: 0, player: false } },
    });
  });
});
