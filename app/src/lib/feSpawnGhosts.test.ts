import { describe, expect, it } from "vitest";
import type { FeKind } from "../generated/FeKind";
import {
  SATELLITE_MAX_DISTANCE,
  SATELLITE_MIN_DISTANCE,
  SPAWN_TREES,
  spawnSatellites,
} from "./feSpawnGhosts";

const KINDS = Object.keys(SPAWN_TREES) as FeKind[];

describe("spawnSatellites", () => {
  it("rolls the same scatter for the same anchor and kind, and another for another anchor", () => {
    const first = spawnSatellites(0, "materialist");
    expect(spawnSatellites(0, "materialist")).toEqual(first);
    expect(spawnSatellites(7, "materialist")).not.toEqual(first);
    expect(spawnSatellites(0, "hive")).not.toEqual(first);
  });

  it("places each kind's satellites as its tree says: within the mod's reach of the home, laned to the home or an earlier satellite", () => {
    for (const kind of KINDS) {
      const tree = SPAWN_TREES[kind];
      const satellites = spawnSatellites(3, kind);
      expect(satellites).toHaveLength(tree.length);
      satellites.forEach((s, i) => {
        const reach = Math.hypot(s.x, s.y);
        expect(reach).toBeGreaterThanOrEqual(SATELLITE_MIN_DISTANCE);
        expect(reach).toBeLessThanOrEqual(SATELLITE_MAX_DISTANCE);
        const parent = tree[i].parent;
        if (parent === null) {
          expect([s.from.x, s.from.y]).toEqual([0, 0]);
        } else {
          expect(parent).toBeLessThan(i);
          expect([s.from.x, s.from.y]).toEqual([satellites[parent].x, satellites[parent].y]);
        }
      });
    }
    expect(SPAWN_TREES.machine.every((s) => s.parent === null)).toBe(true);
    expect(SPAWN_TREES.materialist.filter((s) => s.parent === null)).toHaveLength(3);
  });
});
