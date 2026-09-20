import { describe, expect, it } from "vitest";
import type { Nebula } from "../generated/Nebula";
import { name, OPEN_RESULT, SYSTEMS } from "../store/fixture";
import { nearestCovering, nebulaPreview, type NebulaGeometry } from "./nebulaPreview";
import { SpatialGrid } from "../lib/spatialGrid";

const SYSTEMS_BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]));
const GRID = new SpatialGrid();
GRID.build(SYSTEMS);
/** The fixture's one cloud, at Deneb (-40, 40) with radius 20 and Deneb as its only member. */
const CLOUD = OPEN_RESULT.galaxy.nebulae[0];

function nebula(x: number, y: number, radius: number): Nebula {
  return { name: name("NAME_Other"), x, y, radius, systems: [] };
}

function preview(nebulae: Nebula[], index: number, geometry: NebulaGeometry) {
  return nebulaPreview(SYSTEMS_BY_ID, GRID, nebulae, index, geometry);
}

describe("nebulaPreview", () => {
  it("a system joins when the previewed radius reaches it, and the total counts the members", () => {
    expect(preview([CLOUD], 0, { x: CLOUD.x, y: CLOUD.y, radius: 60 })).toEqual({
      x: -40,
      y: 40,
      radius: 60,
      joining: [0],
      leaving: [],
      total: 2,
    });
  });

  it("a member leaves when the previewed centre carries the cloud off it", () => {
    expect(preview([CLOUD], 0, { x: 10, y: -30, radius: 10 })).toEqual({
      x: 10,
      y: -30,
      radius: 10,
      joining: [4],
      leaving: [5],
      total: 1,
    });
  });

  it("where two clouds overlap a system, the nearer centre keeps it", () => {
    const nebulae = [CLOUD, nebula(-20, 20, 40)];
    expect(preview(nebulae, 0, { x: CLOUD.x, y: CLOUD.y, radius: 60 })).toMatchObject({
      joining: [],
      leaving: [],
      total: 1,
    });
  });

  it("an equal distance goes to the lower file index", () => {
    const twin = nebula(CLOUD.x, CLOUD.y, 60);
    const grown = { x: CLOUD.x, y: CLOUD.y, radius: 60 };
    expect(preview([CLOUD, twin], 0, grown)).toMatchObject({
      joining: [0],
      leaving: [],
      total: 2,
    });
    expect(preview([CLOUD, twin], 1, grown)).toMatchObject({
      joining: [0],
      leaving: [],
      total: 1,
    });
  });

  it("without a grid it scans every system rather than giving up", () => {
    expect(
      nebulaPreview(SYSTEMS_BY_ID, null, [CLOUD], 0, { x: CLOUD.x, y: CLOUD.y, radius: 60 }),
    ).toEqual(preview([CLOUD], 0, { x: CLOUD.x, y: CLOUD.y, radius: 60 }));
  });

  it("scans no further than the discs the drag covers", () => {
    const far = nebula(10_000, 10_000, 5);
    expect(preview([far], 0, { x: 10_000, y: 10_000, radius: 5 })).toMatchObject({
      joining: [],
      leaving: [],
      total: 0,
    });
  });
});

describe("nearestCovering", () => {
  it("takes the nearest centre among those covering the point", () => {
    const discs = [nebula(0, 0, 30), nebula(10, 0, 30)];
    expect(nearestCovering(discs, 9, 0)).toBe(1);
    expect(nearestCovering(discs, 1, 0)).toBe(0);
  });

  it("breaks a tie on the lower file index, and answers none outside every radius", () => {
    const discs = [nebula(0, 0, 30), nebula(20, 0, 30)];
    expect(nearestCovering(discs, 10, 0)).toBe(0);
    expect(nearestCovering(discs, 60, 0)).toBeNull();
  });

  it("counts a point exactly on the edge as covered, as the core's `covers` does", () => {
    expect(nearestCovering([nebula(0, 0, 30)], 30, 0)).toBe(0);
    expect(nearestCovering([nebula(0, 0, 30)], 30.000001, 0)).toBeNull();
  });
});
