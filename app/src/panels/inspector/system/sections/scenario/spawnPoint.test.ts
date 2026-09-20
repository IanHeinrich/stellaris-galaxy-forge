import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../../../../generated/SystemNode";
import { node } from "../../../../../store/fixture";
import { spawnPointsOp, spawnReservationOp, spawnTargets } from "./spawnPoint";

/** A system the generator can weigh, and one it cannot: a weight needs an initializer beside it. */
const weighable = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g");
const plain = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g", [], { initializer: "" });

function systems(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

describe("weighing a selection", () => {
  it("writes one entry per system that can carry a weight, as a single op", () => {
    const map = systems(weighable(0), plain(1), weighable(2));

    expect(spawnTargets([0, 1, 2], map).map((s) => s.id)).toEqual([0, 2]);
    expect(spawnPointsOp([0, 1, 2], map, true)).toEqual({
      type: "SetSpawnWeights",
      entries: [
        [0, 1],
        [2, 1],
      ],
    });
    expect(spawnPointsOp([0, 1, 2], map, false)).toEqual({
      type: "SetSpawnWeights",
      entries: [
        [0, null],
        [2, null],
      ],
    });
  });

  it("keeps the single-system op, whose description names the system", () => {
    const map = systems(weighable(0), plain(1));

    expect(spawnPointsOp([0, 1], map, true)).toEqual({ type: "SetSpawnWeight", id: 0, base: 1 });
  });

  it("writes nothing when no system in the selection can carry a weight", () => {
    const map = systems(weighable(0), plain(1));

    expect(spawnPointsOp([1], map, true)).toBeNull();
    expect(spawnPointsOp([99], map, true)).toBeNull();
    expect(spawnPointsOp([], map, false)).toBeNull();
  });
});

describe("reserving a spawn point", () => {
  it("names the preset to write, and clears whichever stands with null", () => {
    expect(spawnReservationOp(7, "human")).toEqual({
      type: "SetSpawnReservation",
      id: 7,
      reserve: "human",
    });
    expect(spawnReservationOp(7, "ai")).toEqual({
      type: "SetSpawnReservation",
      id: 7,
      reserve: "ai",
    });
    expect(spawnReservationOp(7, null)).toEqual({
      type: "SetSpawnReservation",
      id: 7,
      reserve: null,
    });
  });
});
