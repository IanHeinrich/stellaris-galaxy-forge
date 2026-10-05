import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { copies, images, imagesOfStamps, type Symmetry } from "../geometry/symmetry";
import { blockersOf } from "./grid";
import { seeded } from "../random";
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

const keyOf = (p: Pt): string => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;

function minDistance(points: readonly Pt[], others: readonly Pt[] = points): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    const from = others === points ? i + 1 : 0;
    for (let j = from; j < others.length; j++) {
      min = Math.min(min, Math.hypot(points[i].x - others[j].x, points[i].y - others[j].y));
    }
  }
  return min;
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
    const present = new Set(points.map(keyOf));
    const missing = points.flatMap((p) => images(p, sym)).filter((q) => !present.has(keyOf(q)));
    expect(missing, "images missing from the points").toEqual([]);
    expect(minDistance(points), "closest pair of points").toBeGreaterThanOrEqual(SPACING);
    expect(minDistance(points, BLOCKERS), "closest point to a blocker").toBeGreaterThanOrEqual(
      SPACING,
    );
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
