import { describe, expect, it } from "vitest";
import { byId, feLinkedNode, placedNode as node, zoneAnchor } from "../../test/builders";
import type { SystemNode } from "../../generated/SystemNode";
import { distToSegmentSq } from "../../lib/geometry/geometry";
import { seeded } from "../../lib/random";
import type { LaneRef } from "../../store/editorStore";
import { PickIndex } from "./pickIndex";

function indexed(...nodes: SystemNode[]): PickIndex {
  const index = new PickIndex();
  index.build(byId([...nodes]));
  return index;
}

describe("nearestLane", () => {
  const index = indexed(
    node(1, 0, 0, [2]),
    node(2, 100, 0, [1, 3]),
    node(3, 100, 100),
    node(4, 500, 500),
  );

  it("returns the closest lane within the tolerance with endpoints ordered", () => {
    expect(index.nearestLane(50, 3, 5)).toEqual({ a: 1, b: 2 });
    expect(index.nearestLane(97, 60, 5)).toEqual({ a: 2, b: 3 });
    expect(index.nearestLane(90, 8, 20)).toEqual({ a: 1, b: 2 });
  });

  it("measures to the segment, not its line, and returns null beyond the tolerance", () => {
    expect(index.nearestLane(50, 10, 5)).toBeNull();
    expect(index.nearestLane(-20, 0, 5)).toBeNull();
    expect(index.nearestLane(-20, 0, 25)).toEqual({ a: 1, b: 2 });
    expect(indexed().nearestLane(0, 0, 1e9)).toBeNull();
  });
});

describe("nearestEdge", () => {
  // S1's ring is centred on (-40, 0), so S2's link runs from (200, 0) to (-10, 0).
  const index = indexed(
    zoneAnchor(1, 0, 0, 5),
    feLinkedNode(2, 200, 0, 5),
    node(3, 100, 40, [4]),
    node(4, 200, 40, [3]),
  );

  it("finds a zone's link along the line from the system to the nearest point of the ring", () => {
    const link = { kind: "feLink", anchor: 1, system: 2 };
    expect(index.nearestEdge(100, 3, 5, true)).toEqual(link);
    expect(index.nearestEdge(-8, 0, 5, true)).toEqual(link);
    expect(index.nearestEdge(-20, 0, 5, true)).toBeNull();
    expect(index.nearestEdge(100, 3, 5, false)).toBeNull();
  });

  it("takes a lane in reach before a link, however much closer the link is", () => {
    expect(index.nearestEdge(150, 4, 40, true)).toEqual({ kind: "lane", lane: { a: 3, b: 4 } });
    expect(index.nearestEdge(150, 4, 30, true)).toEqual({
      kind: "feLink",
      anchor: 1,
      system: 2,
    });
  });

  it("ignores a link to an id no anchor takes, an anchor without a zone, and a system inside the ring", () => {
    const inside = feLinkedNode(6, -40, 0, 5);
    const noZone = { ...zoneAnchor(7, 0, 300, 8), fe_zone: null };
    const all = indexed(
      zoneAnchor(1, 0, 0, 5),
      feLinkedNode(2, 200, 0, 9),
      inside,
      noZone,
      feLinkedNode(8, 200, 300, 8),
    );
    expect(all.nearestEdge(100, 0, 5, true)).toBeNull();
    expect(all.nearestEdge(-30, 0, 5, true)).toBeNull();
    expect(all.nearestEdge(100, 300, 5, true)).toBeNull();
  });
});

/** A few hundred systems over a 1000-unit square, each laned to a few near ones and a rare far one. */
function galaxy(rand: () => number): SystemNode[] {
  const nodes = Array.from({ length: 300 }, (_, id) => node(id, rand() * 1000, rand() * 1000));
  return nodes.map((s) => {
    const near = nodes
      .filter((o) => o.id !== s.id && Math.hypot(o.x - s.x, o.y - s.y) < 90)
      .slice(0, 3)
      .map((o) => o.id);
    const far = rand() < 0.02 ? [Math.floor(rand() * nodes.length)] : [];
    return {
      ...s,
      lanes: [...near, ...far].map((to) => ({ to, length: 0, bridge: false, stale: false })),
    };
  });
}

/** The lane a scan of every lane entry finds, as picking did before the index. */
function scanned(
  systems: Map<number, SystemNode>,
  x: number,
  y: number,
  max: number,
): LaneRef | null {
  let bestD2 = max * max;
  let best: LaneRef | null = null;
  for (const a of systems.values()) {
    for (const lane of a.lanes) {
      const b = systems.get(lane.to);
      if (!b) continue;
      const d2 = distToSegmentSq(x, y, a.x, a.y, b.x, b.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = a.id < b.id ? { a: a.id, b: b.id } : { a: b.id, b: a.id };
      }
    }
  }
  return best;
}

/** Two lanes meeting at a system are equally near a point by it, so a pick is judged by distance. */
function distTo(systems: Map<number, SystemNode>, lane: LaneRef, x: number, y: number): number {
  const a = systems.get(lane.a)!;
  const b = systems.get(lane.b)!;
  return distToSegmentSq(x, y, a.x, a.y, b.x, b.y);
}

function expectSameAsScan(index: PickIndex, systems: Map<number, SystemNode>, rand: () => number) {
  for (let i = 0; i < 400; i++) {
    const x = rand() * 1100 - 50;
    const y = rand() * 1100 - 50;
    const max = 2 + rand() * 40;
    const found = index.nearestLane(x, y, max);
    const scan = scanned(systems, x, y, max);
    expect(found === null).toBe(scan === null);
    if (found && scan) expect(distTo(systems, found, x, y)).toBe(distTo(systems, scan, x, y));
  }
}

describe("the pick index against a scan of every lane", () => {
  it("finds the same lane, before and after a delta moves, removes and relanes systems", () => {
    const rand = seeded(7);
    const nodes = galaxy(rand);
    const systems = byId([...nodes]);
    const index = new PickIndex();
    index.build(systems);
    expectSameAsScan(index, systems, rand);

    const moved = [5, 17, 42].map((id) => ({
      ...systems.get(id)!,
      x: rand() * 1000,
      y: rand() * 1000,
    }));
    const removed = [8, 99];
    const relaned = {
      ...systems.get(120)!,
      lanes: [{ to: 3, length: 0, bridge: false, stale: false }],
    };
    const after = new Map(systems);
    for (const id of removed) after.delete(id);
    for (const s of [...moved, relaned]) after.set(s.id, s);
    index.apply({ systems: [...moved, relaned], removed }, after);
    expectSameAsScan(index, after, rand);
  });
});

describe("a delta", () => {
  const ANCHOR = zoneAnchor(1, 0, 0, 5);
  const LINKED = feLinkedNode(2, 200, 0, 5);
  const LINK = { kind: "feLink", anchor: 1, system: 2 };

  it("moves a zone's links with its anchor, and drops them when it stops taking links", () => {
    const index = indexed(ANCHOR, LINKED);
    const moved = { ...ANCHOR, y: 100 };
    index.apply({ systems: [moved] }, byId([moved, LINKED]));
    expect(index.nearestEdge(100, 3, 5, true)).toBeNull();
    expect(index.nearestEdge(-10, 100, 5, true)).toBeNull();
    expect(index.nearestEdge(94, 44, 5, true)).toEqual(LINK);

    const closed = { ...moved, fe_link: { ...moved.fe_link, custom: false } };
    index.apply({ systems: [closed] }, byId([closed, LINKED]));
    expect(index.nearestEdge(94, 44, 5, true)).toBeNull();
  });

  it("links a system that starts listing a zone, and keeps a lane only its untouched end lists", () => {
    const one = node(3, 0, 200, [4]);
    const other = node(4, 100, 200);
    const index = indexed(ANCHOR, one, other, {
      ...LINKED,
      fe_link: { ...LINKED.fe_link, to: [] },
    });
    index.apply({ systems: [LINKED, other] }, byId([ANCHOR, one, other, LINKED]));
    expect(index.nearestEdge(100, 3, 5, true)).toEqual(LINK);
    expect(index.nearestLane(50, 200, 5)).toEqual({ a: 3, b: 4 });

    index.apply({ systems: [], removed: [1] }, byId([one, other, LINKED]));
    expect(index.nearestEdge(100, 3, 5, true)).toBeNull();
    expect([...index.anchors()]).toEqual([]);
  });
});
