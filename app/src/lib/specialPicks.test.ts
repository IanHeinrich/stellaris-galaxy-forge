import { describe, expect, it } from "vitest";
import { byId, clusterMember, placedNode } from "../test/builders";
import { PlacementGround } from "./placement/ground";
import { SpatialGrid } from "./spatialGrid";
import { specialLinks, specialPlacement, type NewSystems } from "./specialPicks";

const RATLINGS: NewSystems = {
  places: [
    clusterMember("Home", { x: 0, y: 0, star_class: "sc_pulsar" }),
    clusterMember("Near", { x: 40, y: 0, refused: "Too close to Ostrava" }),
    clusterMember("Far", { x: 0, y: 60, star_class: "sc_k" }),
  ],
  lanes: [
    [0, 1],
    [0, 2],
  ],
};

function ground(...systems: ReturnType<typeof placedNode>[]): PlacementGround {
  const map = byId(...systems);
  const grid = new SpatialGrid();
  grid.build(map.values());
  return new PlacementGround(map, grid, { kind: "off" });
}

describe("a special system's preview", () => {
  it("draws the systems that fit with their lanes and links, and a refused one apart with none", () => {
    const preview = specialPlacement(RATLINGS, [
      [2, 7],
      [1, 8],
    ]);
    expect(preview.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
    ]);
    expect(preview.classes).toEqual(["sc_pulsar", "sc_k"]);
    expect(preview.pairs).toEqual([
      [-2, -1],
      [-2, 7],
    ]);
    expect(preview.outside).toEqual([{ x: 40, y: 0 }]);
  });

  it("draws one layout in the accent, its star not yet rolled", () => {
    const one = { places: [{ x: 5, y: 5, star_class: null, refused: null }], lanes: [] };
    expect(specialPlacement(one, [[0, 3]]).classes).toBeNull();
  });
});

describe("joining a special system to the galaxy", () => {
  it("lays lanes from the new systems to the existing ones near them, and none among themselves", () => {
    const links = specialLinks(
      RATLINGS,
      ground(placedNode(1, -30, 0), placedNode(2, 0, 90), placedNode(3, 900, 900)),
      1,
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links.every(([index, system]) => index >= 0 && index < 3 && system > 0)).toBe(true);
    expect(links.map(([, system]) => system)).not.toContain(3);
  });

  it("lays none with no system in reach", () => {
    const one = { places: [{ x: 0, y: 0, star_class: null, refused: null }], lanes: [] };
    expect(specialLinks(one, ground(placedNode(3, 900, 900)), 1)).toEqual([]);
  });
});
