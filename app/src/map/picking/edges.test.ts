import { describe, expect, it } from "vitest";
import { byId, feLinkedNode, placedNode as node, zoneAnchor } from "../../test/builders";
import { edgeEnds, sameEdge } from "./edges";

describe("edgeEnds", () => {
  const systems = byId([
    zoneAnchor(1, 0, 0, 5),
    feLinkedNode(2, 200, 0, 5),
    node(3, 100, 40, [4]),
    node(4, 200, 40),
  ]);

  it("resolves a lane to its systems and a link to the system and the ring's nearest point", () => {
    expect(edgeEnds(systems, { kind: "lane", lane: { a: 3, b: 4 } })).toMatchObject({
      a: { x: 100, y: 40 },
      b: { x: 200, y: 40 },
    });
    expect(edgeEnds(systems, { kind: "feLink", anchor: 1, system: 2 })).toEqual({
      a: { x: 200, y: 0 },
      b: { x: -10, y: 0 },
    });
  });

  it("is null for an edge the file no longer has", () => {
    expect(edgeEnds(systems, null)).toBeNull();
    expect(edgeEnds(systems, { kind: "lane", lane: { a: 1, b: 2 } })).toBeNull();
    expect(edgeEnds(systems, { kind: "lane", lane: { a: 3, b: 9 } })).toBeNull();
    expect(edgeEnds(systems, { kind: "feLink", anchor: 1, system: 3 })).toBeNull();
    expect(edgeEnds(systems, { kind: "feLink", anchor: 2, system: 1 })).toBeNull();
  });
});

describe("sameEdge", () => {
  it("compares by kind and ends", () => {
    const lane = { kind: "lane", lane: { a: 1, b: 2 } } as const;
    const link = { kind: "feLink", anchor: 1, system: 2 } as const;
    expect(sameEdge(lane, { kind: "lane", lane: { a: 1, b: 2 } })).toBe(true);
    expect(sameEdge(lane, { kind: "lane", lane: { a: 1, b: 3 } })).toBe(false);
    expect(sameEdge(link, { kind: "feLink", anchor: 1, system: 2 })).toBe(true);
    expect(sameEdge(link, { kind: "feLink", anchor: 2, system: 1 })).toBe(false);
    expect(sameEdge(lane, link)).toBe(false);
    expect(sameEdge(null, null)).toBe(true);
    expect(sameEdge(lane, null)).toBe(false);
  });
});
