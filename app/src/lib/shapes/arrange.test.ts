import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { node } from "../../store/fixture";
import type { Fill, PendingShape } from "./types";
import { arrangement, nearestFree } from "./arrange";
import { NO_EXTRAS } from "./extras";
import { PLACEMENT_RULES } from "../placement/rules";
import { systemsInside } from "./erase";
import { SHAPE_SPECS } from "./specs";

const EXTENT = { shape: "square", half: 500 } as const;

/** `n` systems in a loose cluster about the origin, none joined. */
function cluster(n: number): Map<number, SystemNode> {
  const systems = new Map<number, SystemNode>();
  for (let i = 0; i < n; i++) {
    const a = i * 2.4;
    systems.set(i, node(i, "", Math.cos(a) * i, Math.sin(a) * i, "sc_g", []));
  }
  return systems;
}

function arranging(ids: number[], fill: Fill): PendingShape & { purpose: { kind: "arrange" } } {
  return {
    purpose: { kind: "arrange", ids, lanes: "keep", alsoOuter: false },
    shape: { ...SHAPE_SPECS.circle.initial, centre: { x: 0, y: 0 }, radius: 200 },
    fill,
    lanes: { follow: false, mode: "off", islands: false },
    extras: NO_EXTRAS,
    skipNear: false,
    seed: 3,
    stars: { kind: "random" },
  };
}

describe("arranging", () => {
  it("lays exactly one point per system, whatever the fill, and moves each system once", () => {
    const fills: Fill[] = [
      { kind: "outline", count: 24 },
      { kind: "scattered", spacing: 25, edge: true },
      { kind: "scattered", spacing: 25, edge: false },
      { kind: "grid", spacing: 25, lattice: "square" },
      { kind: "grid", spacing: 25, lattice: "hex" },
    ];
    for (const n of [2, 7, 30, 97]) {
      const systems = cluster(n);
      const ids = [...systems.keys()];
      for (const fill of fills) {
        const preview = arrangement(arranging(ids, fill), {
          systems,
          extent: EXTENT,
          rules: PLACEMENT_RULES.statements,
          symmetry: { kind: "off" },
          laneDensity: 0.5,
        });
        expect(preview.arranged!.refusal, `${fill.kind} of ${n}`).toBeNull();
        expect(preview.points, `${fill.kind} of ${n}`).toHaveLength(n);
        expect(new Set(preview.arranged!.moves.map((m) => m.system)).size).toBe(n);
      }
    }
  });

  it("takes pairs in the order a full sort of every pair gives, without sorting them all", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cloud = (n: number) =>
      Array.from({ length: n }, () => ({ x: rnd() * 100, y: rnd() * 100 }));
    for (const n of [5, 60, 300]) {
      const from = cloud(n);
      const to = cloud(n);
      const pairs = from.flatMap((p, i) =>
        to.map((q, j) => [Math.round(Math.hypot(p.x - q.x, p.y - q.y) * 1024), j, i]),
      );
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const want = new Array<number>(n).fill(-1);
      const taken = new Set<number>();
      for (const [, j, i] of pairs) {
        if (want[i] !== -1 || taken.has(j)) continue;
        want[i] = j;
        taken.add(j);
      }
      expect(nearestFree(from, to)).toEqual(want);
    }
  });

  it("takes the nearest pair first, then the nearest of what is left", () => {
    const from = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const to = [
      { x: 1.2, y: 0 },
      { x: -5, y: 0 },
    ];
    expect(nearestFree(from, to)).toEqual([1, 0]);
  });
});

describe("erasing with a shape", () => {
  it("takes the systems inside it, special ones only when asked, and a line takes none", () => {
    const systems = [
      node(1, "", 0, 0, "sc_g", [], { initializer: "" }),
      node(2, "", 5, 0, "sc_g", []),
      node(3, "", 50, 0, "sc_g", [], { initializer: "" }),
    ];
    const circle = { ...SHAPE_SPECS.circle.initial, centre: { x: 0, y: 0 }, radius: 10 };
    expect(systemsInside(circle, systems, false).map((s) => s.id)).toEqual([1]);
    expect(systemsInside(circle, systems, true).map((s) => s.id)).toEqual([1, 2]);
    const line = { kind: "line" as const, a: { x: -10, y: 0 }, b: { x: 60, y: 0 } };
    expect(systemsInside(line, systems, true)).toEqual([]);
  });
});

describe("arranging into a spiral", () => {
  it("lays one point per system, leaving out the band, rings and centre system an add would lay", () => {
    const systems = cluster(7);
    const ids = [...systems.keys()];
    const preview = arrangement(
      {
        ...arranging(ids, { kind: "outline", count: 24 }),
        shape: SHAPE_SPECS.spiral.initial,
        lanes: { follow: true, mode: "off", islands: false },
        extras: { ...NO_EXTRAS, band: 3, rings: 2, centre: "spokes" },
      },
      {
        systems,
        extent: EXTENT,
        rules: PLACEMENT_RULES.statements,
        symmetry: { kind: "off" },
        laneDensity: 0.5,
      },
    );
    expect(preview.arranged!.refusal).toBeNull();
    expect(preview.points).toHaveLength(7);
  });
});
