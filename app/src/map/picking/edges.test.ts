import { describe, expect, it } from "vitest";
import { name, systemNode } from "../../test/builders";
import type { SystemNode } from "../../generated/SystemNode";
import { newFeZone } from "../../lib/feZone";
import { edgeEnds, nearestEdge, nearestLane, sameEdge } from "./edges";

const node = (id: number, x: number, y: number, to: number[] = []): SystemNode =>
  systemNode({
    id,
    name: name(`S${id}`),
    x,
    y,
    lanes: to.map((t) => ({ to: t, length: 0, bridge: false, stale: false })),
  });

/** An anchor whose ring lies east at 40 and takes custom connections under `linkId`. */
const anchor = (id: number, x: number, y: number, linkId: number): SystemNode => ({
  ...node(id, x, y),
  fe_zone: newFeZone("e"),
  fe_link: { custom: true, id: linkId, to: [] },
});

const linked = (id: number, x: number, y: number, ...to: number[]): SystemNode => ({
  ...node(id, x, y),
  fe_link: { custom: false, id: null, to },
});

function world(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

describe("nearestLane", () => {
  const systems = world(
    node(1, 0, 0, [2]),
    node(2, 100, 0, [1, 3]),
    node(3, 100, 100),
    node(4, 500, 500),
  );

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

describe("nearestEdge", () => {
  // S1's ring is centred on (-40, 0), so S2's link runs from (200, 0) to (-10, 0).
  const systems = world(
    anchor(1, 0, 0, 5),
    linked(2, 200, 0, 5),
    node(3, 100, 40, [4]),
    node(4, 200, 40, [3]),
  );

  it("finds a zone's link along the line from the system to the nearest point of the ring", () => {
    const link = { kind: "feLink", anchor: 1, system: 2 };
    expect(nearestEdge(systems, 100, 3, 5, true)).toEqual(link);
    expect(nearestEdge(systems, -8, 0, 5, true)).toEqual(link);
    expect(nearestEdge(systems, -20, 0, 5, true)).toBeNull();
    expect(nearestEdge(systems, 100, 3, 5, false)).toBeNull();
  });

  it("takes a lane in reach before a link, however much closer the link is", () => {
    expect(nearestEdge(systems, 150, 4, 40, true)).toEqual({ kind: "lane", lane: { a: 3, b: 4 } });
    expect(nearestEdge(systems, 150, 4, 30, true)).toEqual({
      kind: "feLink",
      anchor: 1,
      system: 2,
    });
  });

  it("ignores a link to an id no anchor takes, an anchor without a zone, and a system inside the ring", () => {
    const inside = linked(6, -40, 0, 5);
    const noZone = { ...anchor(7, 0, 300, 8), fe_zone: null };
    const all = world(
      anchor(1, 0, 0, 5),
      linked(2, 200, 0, 9),
      inside,
      noZone,
      linked(8, 200, 300, 8),
    );
    expect(nearestEdge(all, 100, 0, 5, true)).toBeNull();
    expect(nearestEdge(all, -30, 0, 5, true)).toBeNull();
    expect(nearestEdge(all, 100, 300, 5, true)).toBeNull();
  });
});

describe("edgeEnds", () => {
  const systems = world(
    anchor(1, 0, 0, 5),
    linked(2, 200, 0, 5),
    node(3, 100, 40, [4]),
    node(4, 200, 40),
  );

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
