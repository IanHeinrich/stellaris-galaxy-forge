import { describe, expect, it } from "vitest";
import { mapNode } from "./layers/fixture";
import { matchingSystems } from "./matchingSystems";

const NODES = [
  mapNode(0, 0, "Sol", "guardian_dragon"),
  mapNode(1, 10, "Alpha", "guardian_dragon"),
  mapNode(2, 20, "Beta", ""),
  mapNode(3, 30, "Gamma", "guardian_hive"),
];
const SYSTEMS = new Map(NODES.map((n) => [n.id, n]));

describe("matchingSystems", () => {
  it("finds every system carrying the given initializer", () => {
    expect(matchingSystems(SYSTEMS, "guardian_dragon")).toEqual(new Set([0, 1]));
    expect(matchingSystems(SYSTEMS, "guardian_hive")).toEqual(new Set([3]));
  });

  it("matches the empty initializer against the random keys", () => {
    expect(matchingSystems(SYSTEMS, "")).toEqual(new Set([2]));
    expect(matchingSystems(SYSTEMS, "@random")).toEqual(new Set([2]));
  });

  it("matches nothing for a key no system carries", () => {
    expect(matchingSystems(SYSTEMS, "unused_initializer")).toEqual(new Set());
  });
});
