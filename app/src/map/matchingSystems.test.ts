import { describe, expect, it } from "vitest";
import { systemNode } from "../test/builders";
import { matchingSystems } from "./matchingSystems";

const NODES = [
  systemNode({ id: 0, initializer: "guardian_dragon" }),
  systemNode({ id: 1, initializer: "guardian_dragon" }),
  systemNode({ id: 2, initializer: "" }),
  systemNode({ id: 3, initializer: "guardian_hive" }),
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
