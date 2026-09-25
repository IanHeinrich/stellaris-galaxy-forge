import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { drag, sampleStroke } from "../../test/brush";
import { seeded } from "../random";
import { StrokeSampler } from "./sample";
import { inStroke } from "./stroke";

/** Every stamp of a drag through `path`. */
function stampsOf(path: Pt[], r: number): Pt[] {
  return drag(path, r).flat();
}

function minGap(points: readonly Pt[], others: readonly Pt[] = points): number {
  let min = Infinity;
  for (const p of points) {
    for (const q of others) {
      if (p === q) continue;
      min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return min;
}

const R = 40;
const SPACING = 12;
const STAMPS = stampsOf(
  [
    { x: -150, y: 0 },
    { x: -60, y: 35 },
    { x: 20, y: -10 },
    { x: 140, y: 60 },
  ],
  R,
);
const BLOCKERS: Pt[] = [
  { x: -100, y: 10 },
  { x: -20, y: 5 },
  { x: 60, y: 20 },
  { x: 100, y: 45 },
];

describe("sampleStroke", () => {
  it("places the same points for the same seed and different ones for another", () => {
    const a = sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(7));
    expect(sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(7))).toEqual(a);
    expect(sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(8))).not.toEqual(a);
  });

  it("keeps every point inside the stroke and spacing from each other and from blockers", () => {
    const points = sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(1));
    expect(points.length).toBeGreaterThan(60);
    expect(points.every((p) => inStroke(p, STAMPS, R))).toBe(true);
    expect(minGap(points)).toBeGreaterThanOrEqual(SPACING);
    expect(minGap(points, BLOCKERS)).toBeGreaterThanOrEqual(SPACING);
  });

  it("fills the stroke: no stroke point is left farther than twice the spacing from a point or blocker", () => {
    const points = sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(2));
    const all = [...points, ...BLOCKERS];
    const probe = seeded(99);
    for (let n = 0; n < 500; n++) {
      const s = STAMPS[Math.floor(probe() * STAMPS.length)];
      const a = 2 * Math.PI * probe();
      const d = R * Math.sqrt(probe());
      const p = { x: s.x + d * Math.cos(a), y: s.y + d * Math.sin(a) };
      expect(minGap([p], all)).toBeLessThan(2 * SPACING);
    }
  });

  it("stops at the cap", () => {
    expect(sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(3), 25)).toHaveLength(25);
  });
});

describe("StrokeSampler", () => {
  it("gives the batch result however the stamps are split across add calls", () => {
    const batch = sampleStroke(STAMPS, R, SPACING, BLOCKERS, seeded(5));
    const sampler = new StrokeSampler({
      r: R,
      spacing: SPACING,
      blockers: BLOCKERS,
      rand: seeded(5),
    });
    for (let i = 0; i < STAMPS.length; i += 3) sampler.add(STAMPS.slice(i, i + 3));
    expect(sampler.points.map(({ x, y }) => ({ x, y }))).toEqual(batch);
  });

  it("only grows: points placed early stay put as the drag goes on", () => {
    const sampler = new StrokeSampler({ r: R, spacing: SPACING, blockers: [], rand: seeded(6) });
    const early = sampler.add(STAMPS.slice(0, 10)).map(({ x, y }) => ({ x, y }));
    const later = sampler.add(STAMPS.slice(10));
    expect(later.slice(0, early.length).map(({ x, y }) => ({ x, y }))).toEqual(early);
    expect(later.length).toBeGreaterThan(early.length);
  });
});
