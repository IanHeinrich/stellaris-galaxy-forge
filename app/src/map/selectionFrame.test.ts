import { describe, expect, it } from "vitest";
import { name, placedNode } from "../test/builders";
import { selectionFrame } from "./selectionFrame";

const SYSTEMS = new Map([
  [1, placedNode(1, -40, 10)],
  [2, placedNode(2, 60, -20)],
]);
const NEBULA = { name: name("N"), x: 200, y: 100, radius: 30, systems: [] };

describe("the selection frame", () => {
  it("boxes the selected systems, before any selected nebula", () => {
    expect(selectionFrame(SYSTEMS, [1, 2], NEBULA)).toEqual({
      minX: -40,
      minY: -20,
      maxX: 60,
      maxY: 10,
    });
  });

  it("boxes a nebula selected alone by its ring, rather than leaving the galaxy fit to it", () => {
    expect(selectionFrame(SYSTEMS, [], NEBULA)).toEqual({
      minX: 170,
      minY: 70,
      maxX: 230,
      maxY: 130,
    });
    expect(selectionFrame(SYSTEMS, [], undefined)).toBeNull();
  });
});
