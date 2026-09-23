import { describe, expect, it } from "vitest";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import {
  addFeZoneRefusal,
  FE_DIRECTIONS,
  FE_KINDS,
  FE_ZONE_DISTANCES,
  FE_ZONE_RADIUS,
  feZoneBlocked,
  feZoneCentre,
  feZoneOffMap,
  feZoneRefusal,
  firstFreeDirection,
  newFeZone,
  snapFeZone,
} from "./feZone";

const ORIGIN = { x: 0, y: 0 };
const K = 40 / Math.SQRT2;

function systems(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

const at = (id: number, x: number, y: number) => systemNode({ id, x, y });

describe("the zone vocabulary", () => {
  it("lists the eight directions in the mod's order and the seven kinds", () => {
    expect(FE_DIRECTIONS.map((d) => d.key)).toEqual(["e", "se", "s", "sw", "w", "nw", "n", "ne"]);
    expect(FE_KINDS.map((k) => k.key)).toEqual([
      "random",
      "materialist",
      "spiritualist",
      "xenophobe",
      "xenophile",
      "machine",
      "hive",
    ]);
    expect(FE_ZONE_DISTANCES).toHaveLength(18);
    expect(FE_ZONE_DISTANCES[0]).toBe(30);
    expect(FE_ZONE_DISTANCES[17]).toBe(200);
    expect(FE_ZONE_RADIUS).toBe(30);
  });

  it("gives a new zone the mod's defaults, placed by hand", () => {
    expect(newFeZone("n")).toEqual({
      direction: "n",
      kind: "random",
      distance: 40,
      preferred: true,
      fallback: false,
    });
  });
});

describe("feZoneCentre", () => {
  it("puts east at negative x and north at negative y, as the core does", () => {
    expect(feZoneCentre(ORIGIN, { direction: "e", distance: 40 })).toEqual({ x: -40, y: 0 });
    expect(feZoneCentre(ORIGIN, { direction: "w", distance: 40 })).toEqual({ x: 40, y: 0 });
    expect(feZoneCentre(ORIGIN, { direction: "n", distance: 40 })).toEqual({ x: 0, y: -40 });
    expect(feZoneCentre(ORIGIN, { direction: "s", distance: 40 })).toEqual({ x: 0, y: 40 });
  });

  it("splits a diagonal evenly so the centre stays `distance` away", () => {
    const se = feZoneCentre({ x: 10, y: 5 }, { direction: "se", distance: 40 });
    expect(se.x).toBeCloseTo(10 - K);
    expect(se.y).toBeCloseTo(5 + K);
    expect(Math.hypot(se.x - 10, se.y - 5)).toBeCloseTo(40);
    const nw = feZoneCentre(ORIGIN, { direction: "nw", distance: 40 });
    expect(nw.x).toBeCloseTo(K);
    expect(nw.y).toBeCloseTo(-K);
  });
});

describe("snapFeZone", () => {
  it("answers the exact grid point it is given", () => {
    for (const { key: direction } of FE_DIRECTIONS) {
      for (const distance of [30, 110, 200]) {
        const centre = feZoneCentre({ x: 3, y: -7 }, { direction, distance });
        expect(snapFeZone({ x: 3, y: -7 }, centre)).toEqual({ direction, distance });
      }
    }
  });

  it("rounds a point between two grid centres to the nearer one", () => {
    expect(snapFeZone(ORIGIN, { x: -44, y: 1 })).toEqual({ direction: "e", distance: 40 });
    expect(snapFeZone(ORIGIN, { x: -46, y: 1 })).toEqual({ direction: "e", distance: 50 });
    expect(snapFeZone(ORIGIN, { x: 2, y: -60 })).toEqual({ direction: "n", distance: 60 });
  });

  it("clamps a point past the last ring to the last distance", () => {
    expect(snapFeZone(ORIGIN, { x: 900, y: 0 })).toEqual({ direction: "w", distance: 200 });
  });
});

describe("feZoneBlocked", () => {
  it("names the first other system inside the ring, never the anchor", () => {
    const anchor = at(1, 0, 0);
    const other = at(2, 20, 0);
    expect(feZoneBlocked({ x: 10, y: 0 }, systems(anchor), 1)).toBeNull();
    expect(feZoneBlocked({ x: 10, y: 0 }, systems(anchor, other), 1)).toBe(other);
    expect(feZoneBlocked({ x: 45, y: 0 }, systems(anchor, other), 1)).toBe(other);
  });

  it("is clear when every system is at least the radius away", () => {
    const anchor = at(1, 0, 0);
    expect(feZoneBlocked({ x: 30, y: 0 }, systems(anchor, at(2, 60, 0)), 1)).toBeNull();
    expect(feZoneBlocked({ x: 40, y: 0 }, systems(anchor), 1)).toBeNull();
  });
});

describe("feZoneOffMap", () => {
  it("refuses a centre past ±470, as the core does", () => {
    expect(feZoneOffMap({ x: 470, y: 0 })).toBe(false);
    expect(feZoneOffMap({ x: 471, y: 0 })).toBe(true);
    expect(feZoneOffMap({ x: 0, y: -471 })).toBe(true);
  });
});

describe("firstFreeDirection", () => {
  it("takes east when nothing is in the way, and the first clear direction after it", () => {
    const anchor = at(1, 0, 0);
    expect(firstFreeDirection(anchor, systems(anchor))).toBe("e");
    expect(firstFreeDirection(anchor, systems(anchor, at(2, -40, 0)))).toBe("se");
  });

  it("skips a direction whose ring would leave the map", () => {
    const anchor = at(1, -440, 0);
    expect(firstFreeDirection(anchor, systems(anchor))).toBe("se");
    expect(firstFreeDirection(at(1, -450, 0), systems(at(1, -450, 0)))).toBe("s");
  });

  it("gives up when every ring at distance 40 is covered", () => {
    const anchor = at(1, 0, 0);
    const ring = FE_DIRECTIONS.map(({ key }, i) => {
      const c = feZoneCentre(anchor, { direction: key, distance: 40 });
      return at(10 + i, c.x, c.y);
    });
    expect(firstFreeDirection(anchor, systems(anchor, ...ring))).toBeNull();
  });
});

describe("the refusals", () => {
  it("says which system is in the way, or that the ring leaves the map", () => {
    expect(feZoneRefusal(at(2, 0, 0), () => "Sol")).toBe(
      "The ring would cover Sol. A fallen empire zone must be empty space.",
    );
    expect(feZoneRefusal(null, () => "Sol")).toBe("The ring would lie off the map.");
  });

  it("refuses a second zone on one anchor, and an anchor with no room", () => {
    const zoned = systemNode({ id: 1, fe_zone: newFeZone("e") });
    expect(addFeZoneRefusal(zoned, systems(zoned))).toBe("This system already anchors a zone");
    const anchor = at(1, 0, 0);
    const ring = FE_DIRECTIONS.map(({ key }, i) => {
      const c = feZoneCentre(anchor, { direction: key, distance: 40 });
      return at(10 + i, c.x, c.y);
    });
    expect(addFeZoneRefusal(anchor, systems(anchor, ...ring))).toBe(
      "No clear space for a ring at distance 40",
    );
    expect(addFeZoneRefusal(anchor, systems(anchor))).toBeNull();
  });
});
