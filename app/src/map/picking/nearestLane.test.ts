import { describe, expect, it } from "vitest";
import { name, systemNode } from "../../test/builders";
import type { SystemNode } from "../../generated/SystemNode";
import { nearestLane } from "./nearestLane";

const node = (id: number, x: number, y: number, to: number[]): SystemNode =>
  systemNode({
    id,
    name: name(`S${id}`),
    x,
    y,
    lanes: to.map((t) => ({ to: t, length: 0, bridge: false, stale: false })),
  });

describe("nearestLane", () => {
  const systems = new Map<number, SystemNode>();
  for (const s of [
    node(1, 0, 0, [2]),
    node(2, 100, 0, [1, 3]),
    node(3, 100, 100, []),
    node(4, 500, 500, []),
  ]) {
    systems.set(s.id, s);
  }

  it("returns the closest lane within the tolerance with endpoints ordered", () => {
    expect(nearestLane(systems, 50, 3, 5)).toEqual({ a: 1, b: 2 });
    expect(nearestLane(systems, 97, 60, 5)).toEqual({ a: 2, b: 3 });
    expect(nearestLane(systems, 90, 8, 20)).toEqual({ a: 1, b: 2 });
  });

  it("measures to the segment, not its line, and returns null beyond the tolerance", () => {
    expect(nearestLane(systems, 50, 10, 5)).toBeNull();
    expect(nearestLane(systems, -20, 0, 5)).toBeNull();
    expect(nearestLane(systems, -20, 0, 25)).toEqual({ a: 1, b: 2 });
    expect(nearestLane(new Map(), 0, 0, 1e9)).toBeNull();
  });
});
