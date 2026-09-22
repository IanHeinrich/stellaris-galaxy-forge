import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { copies, images, imagesOfStamps, type Symmetry } from "../geometry/symmetry";
import { blockersOf } from "./grid";
import { seeded } from "./random";
import { SymmetricSpacing } from "./symmetricSpacing";

const SYMMETRIES: Symmetry[] = [
  { kind: "off" },
  { kind: "mirror", axis: "x" },
  { kind: "mirror", axis: "y" },
  { kind: "rotate", n: 2 },
  { kind: "rotate", n: 3 },
  { kind: "rotate", n: 4 },
  { kind: "rotate", n: 6 },
  { kind: "rotate", n: 8 },
];

function has(points: readonly Pt[], p: Pt): boolean {
  return points.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
}

/** `base` replicated under `sym`, keeping each base point that fits beside those kept before it. */
function symmetricPoints(base: readonly Pt[], sym: Symmetry, spacing: number, blockers: Pt[]) {
  const guard = new SymmetricSpacing(sym, spacing, blockersOf(blockers, spacing));
  const kept = base.filter((p) => {
    if (!guard.fits(p)) return false;
    guard.take(p);
    return true;
  });
  return { base: kept, points: imagesOfStamps(kept, sym).flat() };
}

function scatter(n: number, seed: number): Pt[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, () => ({ x: rand() * 400 - 200, y: rand() * 400 - 200 }));
}

describe("symmetricPoints", () => {
  const SPACING = 15;
  const BLOCKERS = scatter(20, 11);

  it.each(SYMMETRIES)("is exactly symmetric and holds spacing across copies: %o", (sym) => {
    const base = scatter(200, 3);
    const { base: kept, points } = symmetricPoints(base, sym, SPACING, BLOCKERS);
    expect(kept.length).toBeGreaterThan(0);
    expect(points).toHaveLength(kept.length * copies(sym));
    for (const p of points) for (const q of images(p, sym)) expect(has(points, q)).toBe(true);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(d).toBeGreaterThanOrEqual(SPACING);
      }
      for (const b of BLOCKERS) {
        expect(Math.hypot(points[i].x - b.x, points[i].y - b.y)).toBeGreaterThanOrEqual(SPACING);
      }
    }
  });

  it("drops base points whose images crowd each other at the centre or on the mirror axis", () => {
    const base = [
      { x: 1, y: 1 },
      { x: 50, y: 3 },
      { x: 50, y: 40 },
    ];
    expect(symmetricPoints(base, { kind: "mirror", axis: "x" }, 10, []).base).toEqual([
      { x: 50, y: 40 },
    ]);
    expect(symmetricPoints(base, { kind: "rotate", n: 6 }, 10, []).base).toEqual(base.slice(1));
  });
});
