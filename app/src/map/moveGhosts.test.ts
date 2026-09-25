import { describe, expect, it } from "vitest";
import { placedNode as node } from "../test/builders";
import { ghostLaneSegments } from "./moveGhosts";

describe("ghostLaneSegments", () => {
  it("joins two moved systems once at their ghosts and a moved one to its unmoved neighbour", () => {
    const systems = new Map([
      [1, node(1, 0, 0, [2, 3])],
      [2, node(2, 10, 0, [1])],
      [3, node(3, 0, 10, [1])],
    ]);
    const a = { id: 1, x: 5, y: 5 };
    const b = { id: 2, x: 15, y: 5 };
    expect(ghostLaneSegments(systems, [a, b])).toEqual([
      [a, b],
      [a, systems.get(3)],
    ]);
  });

  it("is empty with no ghosts or for a ghost of an unknown system", () => {
    const systems = new Map([[1, node(1, 0, 0, [])]]);
    expect(ghostLaneSegments(systems, [])).toEqual([]);
    expect(ghostLaneSegments(systems, [{ id: 9, x: 0, y: 0 }])).toEqual([]);
  });
});
