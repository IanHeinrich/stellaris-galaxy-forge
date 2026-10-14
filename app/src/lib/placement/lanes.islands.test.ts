import { describe, expect, it } from "vitest";
import { BRUSH_SETTINGS, drag } from "../../test/brush";
import { BrushStroke } from "../brush/brushStroke";
import { componentCount } from "../geometry/joinIslands";
import type { MeshPoint } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import type { Symmetry } from "../geometry/symmetry";
import { NO_EXTRAS } from "../shapes/extras";
import { shapePlacement } from "../shapes/placement";
import {
  circle,
  components,
  crossings,
  EMPTY,
  groundOf,
  pending,
} from "../shapes/placement.fixture";
import { SpatialGrid } from "../spatialGrid";
import { provisionalIndex, strokeLanes, withProvisionalIds } from "./lanes";

const MIRROR: Symmetry = { kind: "mirror", axis: "x" };
/** A stroke beside the mirror's axis, whose halves join only across it. */
const ALONG_AXIS: Pt[] = [
  { x: 100, y: 25 },
  { x: 300, y: 25 },
];
const ISLANDS = { follow: false, mode: "new", islands: true } as const;
const SCATTERED = { kind: "scattered", spacing: 15, edge: false } as const;

/** How far segment pq passes from `s`. */
function clearance(s: Pt, p: Pt, q: Pt): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const t = Math.max(0, Math.min(1, ((s.x - p.x) * dx + (s.y - p.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x + t * dx - s.x, p.y + t * dy - s.y);
}

describe("lanes like the game", () => {
  it("never runs a lane between new systems over a lone existing star they ring", () => {
    const star: MeshPoint = { id: 1, x: 0, y: 0 };
    const ring = withProvisionalIds(
      Array.from({ length: 10 }, (_, k) => ({
        x: 30 * Math.cos((k * Math.PI) / 5),
        y: 30 * Math.sin((k * Math.PI) / 5),
      })),
    );
    const at = new Map([...ring, star].map((p) => [p.id, p]));
    for (const seed of [1, 2, 3, 4]) {
      const pairs = strokeLanes({
        added: ring,
        nearby: [star],
        existing: [],
        density: 1,
        mode: "nearby",
        maxLength: 100,
        islandSeed: seed,
      });
      const among = pairs.filter(([a, b]) => a < 0 && b < 0);
      expect(among.length).toBeGreaterThan(0);
      for (const [a, b] of among) {
        expect(clearance(star, at.get(a)!, at.get(b)!)).toBeGreaterThan(20);
      }
    }
  });

  it("keeps a mirror-symmetric paint stroke one network across the axis", () => {
    const settings = {
      ...BRUSH_SETTINGS,
      size: 80,
      spacing: 12,
      laneMode: "new",
      laneIslands: true,
      symmetry: MIRROR,
    } as const;
    const grid = new SpatialGrid();
    grid.build([]);
    for (const seed of [1, 2, 3]) {
      const s = new BrushStroke(settings, new Map(), grid, seed, { systems: new Map(), grid });
      for (const stamps of drag(ALONG_AXIS, 40)) {
        s.add(stamps);
      }
      const result = s.result();
      if (result.kind !== "paint") throw new Error(result.kind);
      expect(result.points.length).toBeGreaterThan(20);
      expect(componentCount(withProvisionalIds(result.points), result.pairs)).toBe(1);
    }
  });

  it("keeps a symmetric circle one network across its copies", () => {
    for (const symmetry of [MIRROR, { kind: "rotate", n: 3 } as const]) {
      for (const seed of [1, 2, 3]) {
        const preview = shapePlacement(
          { ...pending(circle(), { fill: SCATTERED, lanes: ISLANDS }), seed },
          groundOf([], symmetry),
        );
        expect(preview.points.length).toBeGreaterThan(40);
        expect(components(preview)).toBe(1);
        expect(crossings(preview)).toBe(0);
      }
    }
  });

  it("grows islands only over the lanes Follow the shape and gaps allow, so each part stays whole", () => {
    for (const seed of [1, 2, 3]) {
      const preview = shapePlacement(
        pending(circle(), {
          lanes: { follow: true, mode: "new", islands: true },
          extras: { ...NO_EXTRAS, band: 3, gaps: 2 },
          seed,
        }),
        EMPTY,
      );
      const parent = preview.points.map((_, i) => i);
      const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
      for (const [a, b] of preview.pairs) {
        parent[root(provisionalIndex(a))] = root(provisionalIndex(b));
      }
      expect(new Set(preview.points.map((_, i) => root(i))).size).toBe(2);
      expect(crossings(preview)).toBe(0);
    }
  });
});
