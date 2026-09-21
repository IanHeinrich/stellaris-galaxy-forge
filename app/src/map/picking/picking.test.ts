import { describe, expect, it } from "vitest";
import { name, systemNode } from "../../test/builders";
import type { Nebula } from "../../generated/Nebula";
import type { SystemNode } from "../../generated/SystemNode";
import { Camera } from "../Camera";
import { pickEdge, pickFeZone, pickNebula, pickSystem, snapTarget } from "./index";
import { newFeZone } from "../../lib/feZone";
import { SpatialGrid } from "../../lib/spatialGrid";

const node = (id: number, x: number, y: number, to: number[] = []): SystemNode =>
  systemNode({
    id,
    name: name(`S${id}`),
    x,
    y,
    lanes: to.map((t) => ({ to: t, length: 0, bridge: false, stale: false })),
  });

function nebula(x: number, y: number, radius: number): Nebula {
  return { name: name("N"), x, y, radius, systems: [] };
}

function world(nodes: SystemNode[]): { systems: Map<number, SystemNode>; grid: SpatialGrid } {
  const systems = new Map(nodes.map((s) => [s.id, s]));
  const grid = new SpatialGrid();
  grid.build(nodes);
  return { systems, grid };
}

function camera(scale: number): Camera {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.scale = scale;
  return cam;
}

const FROM = (...ids: number[]) => ({ kind: "systems", ids }) as const;
const FROM_ZONE = (anchor: number) => ({ kind: "feZone", anchor }) as const;

describe("picking", () => {
  it("picks the star, then the port band, then nothing as the point moves out", () => {
    const { grid } = world([node(1, 0, 0)]);
    const cam = camera(1);

    expect(pickSystem(grid, cam, { x: 5, y: 0 })).toEqual({ system: 1, zone: "star" });
    expect(pickSystem(grid, cam, { x: 14, y: 0 })).toEqual({ system: 1, zone: "port" });
    expect(pickSystem(grid, cam, { x: 20, y: 0 })).toEqual({ system: null, zone: null });
  });

  it("has no port band below the port zoom, and reaches further in world units when zoomed out", () => {
    const { grid } = world([node(1, 0, 0)]);
    const cam = camera(0.5);

    expect(pickSystem(grid, cam, { x: 20, y: 0 })).toEqual({ system: 1, zone: "star" });
    expect(pickSystem(grid, cam, { x: 26, y: 0 })).toEqual({ system: null, zone: null });
  });

  it("picks the nearest system, not the first in the cell", () => {
    const { grid } = world([node(1, 0, 0), node(2, 9, 0)]);
    const cam = camera(1);

    expect(pickSystem(grid, cam, { x: 6, y: 0 }).system).toBe(2);
    expect(pickSystem(grid, cam, { x: 3, y: 0 }).system).toBe(1);
  });

  it("picks a lane within its radius and flags the midpoint button", () => {
    const { systems } = world([node(1, 0, 0, [2]), node(2, 100, 0, [1])]);
    const cam = camera(1);
    const lane = { kind: "lane", lane: { a: 1, b: 2 } };

    expect(pickEdge(systems, cam, { x: 50, y: 2 }, null, true)).toEqual({
      edge: lane,
      midpointHit: true,
    });
    expect(pickEdge(systems, cam, { x: 20, y: 2 }, null, true)).toEqual({
      edge: lane,
      midpointHit: false,
    });
    expect(pickEdge(systems, cam, { x: 20, y: 10 }, null, true)).toEqual({
      edge: null,
      midpointHit: false,
    });
  });

  it("picks a zone's link along its line and flags its midpoint, only while links are shown", () => {
    // S1's ring lies east at 40, so the link from S2 runs from (200, 0) to the ring at (-10, 0).
    const anchor = {
      ...node(1, 0, 0),
      fe_zone: newFeZone("e"),
      fe_link: { custom: true, id: 5, to: [] },
    };
    const linked = { ...node(2, 200, 0), fe_link: { custom: false, id: null, to: [5] } };
    const { systems } = world([anchor, linked]);
    const cam = camera(1);
    const link = { kind: "feLink", anchor: 1, system: 2 };

    expect(pickEdge(systems, cam, { x: 95, y: 3 }, null, true)).toEqual({
      edge: link,
      midpointHit: true,
    });
    expect(pickEdge(systems, cam, { x: 150, y: 3 }, null, true)).toEqual({
      edge: link,
      midpointHit: false,
    });
    expect(pickEdge(systems, cam, { x: 150, y: 3 }, null, false).edge).toBeNull();
    expect(pickEdge(systems, cam, { x: -20, y: 0 }, null, true).edge).toBeNull();
  });

  it("keeps the sticky edge while the point is on its midpoint button", () => {
    const { systems } = world([
      node(1, 0, 0, [2]),
      node(2, 100, 0, [1]),
      node(3, 40, 4, [4]),
      node(4, 60, 4, [3]),
    ]);
    const cam = camera(1);
    const far = { kind: "lane", lane: { a: 1, b: 2 } } as const;

    expect(pickEdge(systems, cam, { x: 50, y: 3 }, null, true).edge).toEqual({
      kind: "lane",
      lane: { a: 3, b: 4 },
    });
    expect(pickEdge(systems, cam, { x: 50, y: 3 }, far, true)).toEqual({
      edge: far,
      midpointHit: true,
    });
  });

  it("snaps to the nearest system outside the drag, and says whether the lane is new", () => {
    const { systems, grid } = world([node(1, 0, 0, [2]), node(2, 100, 0, [1]), node(3, 104, 0)]);
    const cam = camera(1);

    expect(snapTarget(grid, systems, cam, { x: 98, y: 0 }, FROM(1), true)).toEqual({
      kind: "system",
      id: 2,
      valid: false,
    });
    expect(snapTarget(grid, systems, cam, { x: 103, y: 0 }, FROM(1), true)).toEqual({
      kind: "system",
      id: 3,
      valid: true,
    });
    expect(snapTarget(grid, systems, cam, { x: 2, y: 0 }, FROM(1), true)).toBeNull();
  });

  it("snaps a drag from systems to a zone's ring line while zones show, valid when one of them can link", () => {
    // S1's ring is centred on (-40, 0); S3 is already linked to it.
    const anchor = {
      ...node(1, 0, 0),
      fe_zone: newFeZone("e"),
      fe_link: { custom: true, id: 5, to: [] },
    };
    const linked = { ...node(3, 300, 0), fe_link: { custom: false, id: null, to: [5] } };
    const { systems, grid } = world([anchor, node(2, 200, 0), linked]);
    const cam = camera(1);

    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM(2), true)).toEqual({
      kind: "feZone",
      anchor: 1,
      valid: true,
    });
    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM(3), true)).toMatchObject({
      valid: false,
    });
    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM(1), true)).toMatchObject({
      valid: false,
    });
    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM(3, 2), true)).toMatchObject({
      valid: true,
    });
    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM(2), false)).toBeNull();
    expect(snapTarget(grid, systems, cam, { x: -40, y: 0 }, FROM(2), true)).toBeNull();
  });

  it("snaps a drag from a zone's port to a system, refusing the anchor and one already linked", () => {
    const anchor = {
      ...node(1, 0, 0),
      fe_zone: newFeZone("e"),
      fe_link: { custom: true, id: 5, to: [] },
    };
    const linked = { ...node(3, 300, 0), fe_link: { custom: false, id: null, to: [5] } };
    const { systems, grid } = world([anchor, node(2, 200, 0), linked]);
    const cam = camera(1);

    expect(snapTarget(grid, systems, cam, { x: 198, y: 0 }, FROM_ZONE(1), true)).toEqual({
      kind: "system",
      id: 2,
      valid: true,
    });
    expect(snapTarget(grid, systems, cam, { x: 298, y: 0 }, FROM_ZONE(1), true)).toEqual({
      kind: "system",
      id: 3,
      valid: false,
    });
    expect(snapTarget(grid, systems, cam, { x: 2, y: 0 }, FROM_ZONE(1), true)).toEqual({
      kind: "system",
      id: 1,
      valid: false,
    });
    expect(snapTarget(grid, systems, cam, { x: -60, y: 0 }, FROM_ZONE(1), true)).toBeNull();
  });
});

describe("pickNebula", () => {
  const CLOUD = nebula(0, 0, 40);
  const cam = camera(1);

  it("picks the centre, the ring band, and nothing inside the disc", () => {
    expect(pickNebula([CLOUD], cam, { x: 6, y: 0 }, null)).toEqual({ index: 0, part: "centre" });
    expect(pickNebula([CLOUD], cam, { x: 0, y: 19 }, null)).toEqual({ index: 0, part: "centre" });
    expect(pickNebula([CLOUD], cam, { x: 37, y: 0 }, null)).toEqual({ index: 0, part: "ring" });
    expect(pickNebula([CLOUD], cam, { x: 0, y: 45 }, null)).toEqual({ index: 0, part: "ring" });
    expect(pickNebula([CLOUD], cam, { x: 25, y: 0 }, null)).toBeNull();
    expect(pickNebula([CLOUD], cam, { x: 47, y: 0 }, null)).toBeNull();
  });

  it("offers the four cardinal handles, each naming its axis, only while the nebula is selected", () => {
    for (const [at, axis] of [
      [{ x: 40, y: 0 }, "x"],
      [{ x: -40, y: 0 }, "x"],
      [{ x: 0, y: 40 }, "y"],
      [{ x: 0, y: -40 }, "y"],
    ] as const) {
      expect(pickNebula([CLOUD], cam, at, 0)).toEqual({ index: 0, part: "handle", axis });
      expect(pickNebula([CLOUD], cam, at, null)).toEqual({ index: 0, part: "ring" });
    }
  });

  it("reaches further in world units when zoomed out", () => {
    expect(pickNebula([CLOUD], camera(0.5), { x: 51, y: 0 }, null)).toEqual({
      index: 0,
      part: "ring",
    });
    expect(pickNebula([CLOUD], camera(0.5), { x: 54, y: 0 }, null)).toBeNull();
  });

  it("keeps the ring grabbable on a cloud drawn no bigger than the centre marker", () => {
    const far = camera(0.15);
    expect(pickNebula([nebula(0, 0, 30)], far, { x: 30, y: 0 }, null)).toEqual({
      index: 0,
      part: "ring",
    });
    expect(pickNebula([nebula(0, 0, 30)], far, { x: 10, y: 0 }, null)).toEqual({
      index: 0,
      part: "centre",
    });
  });

  it("prefers a centre to a ring, and the nearer of two rings", () => {
    const pair = [CLOUD, nebula(40, 0, 40)];
    expect(pickNebula(pair, cam, { x: 4, y: 0 }, null)).toEqual({ index: 0, part: "centre" });
    expect(pickNebula(pair, cam, { x: 78, y: 0 }, null)).toEqual({ index: 1, part: "ring" });
  });

  it("is not consulted while a system is under the pointer: the system wins the tie", () => {
    const { grid } = world([node(1, 40, 0)]);
    const at = { x: 40, y: 0 };
    expect(pickSystem(grid, cam, at).system).toBe(1);
    expect(pickNebula([CLOUD], cam, at, null)).toEqual({ index: 0, part: "ring" });
  });

  it("keeps a nebula shrunk to near zero grabbable by its centre, with the ring still winning near the edge", () => {
    const shrunk = nebula(0, 0, 1);
    expect(pickNebula([shrunk], cam, { x: 2, y: 0 }, null)).toEqual({ index: 0, part: "centre" });
    expect(pickNebula([shrunk], cam, { x: 5, y: 0 }, null)).toEqual({ index: 0, part: "ring" });
  });
});

describe("pickFeZone", () => {
  /** An anchor at the origin whose ring, east at 40, is centred on (-40, 0). */
  const anchored = { ...node(1, 0, 0), fe_zone: newFeZone("e") };
  const cam = camera(1);

  const ring = { anchor: 1, zone: "ring" };
  const port = { anchor: 1, zone: "port" };

  it("picks the ring band, the port band just outside it, and nothing inside or beyond, naming the anchor", () => {
    const { systems } = world([anchored, node(2, 200, 0)]);
    expect(pickFeZone(systems, cam, { x: -10, y: 0 })).toEqual(ring);
    expect(pickFeZone(systems, cam, { x: -40, y: 33 })).toEqual(ring);
    expect(pickFeZone(systems, cam, { x: -76, y: 0 })).toEqual(ring);
    expect(pickFeZone(systems, cam, { x: -3, y: 0 })).toEqual(port);
    expect(pickFeZone(systems, cam, { x: 2, y: 0 })).toEqual(port);
    expect(pickFeZone(systems, cam, { x: -78, y: 0 })).toEqual(port);
    expect(pickFeZone(systems, cam, { x: -40, y: 0 })).toBeNull();
    expect(pickFeZone(systems, cam, { x: -20, y: 0 })).toBeNull();
    expect(pickFeZone(systems, cam, { x: 3, y: 0 })).toBeNull();
  });

  it("reaches further in world units when zoomed out, the port band scaling with the markers", () => {
    const { systems } = world([anchored]);
    expect(pickFeZone(systems, camera(0.5), { x: -81, y: 0 })).toEqual(ring);
    expect(pickFeZone(systems, camera(0.5), { x: -84, y: 0 })).toEqual(port);
    expect(pickFeZone(systems, camera(0.5), { x: -90, y: 0 })).toEqual(port);
    expect(pickFeZone(systems, camera(0.5), { x: -93, y: 0 })).toBeNull();
  });

  it("takes the nearer of two rings, a ring band over a port band, and ignores a system that anchors none", () => {
    const twin = { ...node(2, 20, 0), fe_zone: newFeZone("e") };
    const { systems } = world([anchored, twin, node(3, -40, 0)]);
    expect(pickFeZone(systems, cam, { x: -8, y: 0 })).toEqual(ring);
    expect(pickFeZone(systems, cam, { x: 12, y: 0 })).toEqual({ anchor: 2, zone: "ring" });
    const near = { ...node(2, 8, 0), fe_zone: newFeZone("e") };
    expect(pickFeZone(world([anchored, near]).systems, cam, { x: -3, y: 0 })).toEqual({
      anchor: 2,
      zone: "ring",
    });
  });
});
