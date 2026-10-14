import { describe, expect, it } from "vitest";
import { distance } from "./frame";
import {
  appliedExtras,
  ARRANGE_MOST_WOBBLE,
  BAND_SCATTER,
  crossesGapAt,
  extraApplies,
  gapSteps,
  NO_EXTRAS,
  outlineRow,
  takesCentre,
} from "./extras";
import { runPoints } from "./outline";
import { SHAPE_SPECS } from "./specs";
import type { Fill, Shape, ShapeExtras, ShapeLanes } from "./types";

const RING = SHAPE_SPECS.circle.initial;
const CENTRE = RING.centre;
/** The chord between neighbours of 24 points round a ring of radius 200. */
const STEP = 2 * RING.radius * Math.sin(Math.PI / 24);
const SEED = 11;

function row(extras: Partial<ShapeExtras>, seed = SEED) {
  return outlineRow(RING, 24, { ...NO_EXTRAS, ...extras }, seed);
}

describe("an outline's extras", () => {
  it("lays rings inside the outline a step apart, each keeping about the same step", () => {
    const { outline, step } = row({ rings: 3 });
    expect(step).toBeCloseTo(STEP);
    const radii = outline.runs.map((run) =>
      runPoints(outline.points, run).map((p) => distance(p, CENTRE)),
    );
    expect(radii).toHaveLength(3);
    radii.forEach((ring, k) => {
      for (const r of ring) {
        expect(RING.radius - r).toBeGreaterThanOrEqual(k * STEP - 1e-9);
        expect(RING.radius - r).toBeLessThan(k * STEP * 1.01 + 1e-9);
      }
    });
    expect(outline.runs.map((run) => run.count)).toEqual([24, 18, 11]);
    expect(outline.runs.every((run) => run.closed)).toBe(true);
  });

  it("thickens the outline into a band of runs a step apart, each point within its share of it", () => {
    const { outline } = row({ band: 3 });
    expect(outline.runs).toHaveLength(3);
    expect(outline.points).toHaveLength(72);
    const half = STEP + BAND_SCATTER * STEP * Math.SQRT2;
    for (const p of outline.points) {
      expect(Math.abs(distance(p, CENTRE) - RING.radius)).toBeLessThanOrEqual(half);
    }
    const mean = (k: number) => {
      const points = runPoints(outline.points, outline.runs[k]);
      return points.reduce((t, p) => t + distance(p, CENTRE), 0) / points.length;
    };
    const means = [mean(0), mean(1), mean(2)].sort((a, b) => a - b);
    expect(means[0]).toBeCloseTo(RING.radius - STEP, -1);
    expect(means[1]).toBeCloseTo(RING.radius, -1);
    expect(means[2]).toBeCloseTo(RING.radius + STEP, -1);
  });

  it("wobbles each point up to half the step, the same for the same seed", () => {
    const plain = row({}).outline.points;
    const full = row({ wobble: 100 }).outline.points;
    full.forEach((p, i) => expect(distance(p, plain[i])).toBeLessThanOrEqual(STEP / 2 + 1e-9));
    expect(Math.max(...full.map((p, i) => distance(p, plain[i])))).toBeGreaterThan(STEP / 4);
    expect(row({ wobble: 100 }).outline.points).toEqual(full);
    expect(row({ wobble: 100 }, SEED + 1).outline.points).not.toEqual(full);
    const half = row({ wobble: 50 }).outline.points;
    half.forEach((p, i) => expect(distance(p, plain[i])).toBeLessThanOrEqual(STEP / 4 + 1e-9));
  });

  it("puts a system at the centre after the outline, with spokes to the ring nearest it", () => {
    expect(row({ centre: "system" }).hub).toEqual({ index: 24, spokes: [] });
    const { outline, hub } = row({ centre: "spokes", rings: 2 });
    const inner = outline.runs[1];
    expect(hub).toEqual({
      index: outline.points.length - 1,
      spokes: Array.from({ length: inner.count }, (_, i) => inner.start + i),
    });
    expect(outline.points[hub!.index]).toEqual(CENTRE);
  });

  it("joins a spiral's centre to each arm's inner end", () => {
    const spiral = { ...SHAPE_SPECS.spiral.initial, arms: 3 };
    const { hub } = outlineRow(spiral, 30, { ...NO_EXTRAS, centre: "spokes" }, SEED);
    expect(hub?.spokes).toEqual([0, 10, 20]);
  });

  it("spreads gaps evenly round a closed run, and clear of an open run's ends", () => {
    expect([...gapSteps(24, true, 3)]).toEqual([0, 8, 16]);
    expect([...gapSteps(10, false, 2)]).toEqual([3, 6]);
    expect(gapSteps(5, true, 9).size).toBe(5);
    expect(gapSteps(24, true, 0).size).toBe(0);
  });
});

describe("where each extra applies", () => {
  const outline: Fill = { kind: "outline", count: 24 };
  const grid: Fill = { kind: "grid", spacing: 20, lattice: "hex" };
  const follow: ShapeLanes = { follow: true, mode: "off" };
  const at = (shape = RING as typeof RING | typeof SHAPE_SPECS.spiral.initial) => ({
    shape,
    fill: outline,
    lanes: follow,
  });

  it("takes rings only round a closed outline, and gaps only along follow lanes", () => {
    expect(extraApplies("rings", at(), "add")).toBe(true);
    expect(extraApplies("rings", at(SHAPE_SPECS.spiral.initial), "add")).toBe(false);
    expect(extraApplies("band", at(SHAPE_SPECS.spiral.initial), "add")).toBe(true);
    expect(extraApplies("gaps", { ...at(), lanes: { ...follow, follow: false } }, "add")).toBe(
      false,
    );
    expect(extraApplies("wobble", { ...at(), fill: grid }, "add")).toBe(true);
    expect(extraApplies("band", { ...at(), fill: grid }, "add")).toBe(false);
  });

  it("leaves out what would lay more points than an arrange moves", () => {
    expect(extraApplies("band", at(), "arrange")).toBe(false);
    expect(extraApplies("rings", at(), "arrange")).toBe(false);
    expect(extraApplies("gaps", at(), "arrange")).toBe(true);
    expect(extraApplies("wobble", at(), "arrange")).toBe(true);
    expect(takesCentre(at(), "add")).toBe(true);
    expect(takesCentre(at(), "arrange")).toBe(false);
    expect(takesCentre({ ...at(), fill: grid }, "add")).toBe(false);
    expect(takesCentre({ ...at(), shape: SHAPE_SPECS.star.initial }, "add")).toBe(false);
  });
});

describe("rings", () => {
  /** The least distance between a point of one run and a point of the next. */
  function nearestBetweenRings(shape: Shape, count: number, extras: Partial<ShapeExtras>) {
    const { outline, step } = outlineRow(shape, count, { ...NO_EXTRAS, ...extras }, SEED);
    const runs = outline.runs.map((run) => runPoints(outline.points, run));
    let least = Infinity;
    for (let k = 1; k < runs.length; k++) {
      for (const p of runs[k - 1]) for (const q of runs[k]) least = Math.min(least, distance(p, q));
    }
    return { least, step, rings: runs.length };
  }

  it("keeps each ring at least a step from the next, for a rectangle, a star and a squashed circle", () => {
    const shapes: Shape[] = [
      { ...SHAPE_SPECS.rect.initial, width: 400, height: 120 },
      { ...SHAPE_SPECS.star.initial, inner: 40 },
      { ...SHAPE_SPECS.circle.initial, squash: 40 },
    ];
    for (const shape of shapes) {
      const { least, step, rings } = nearestBetweenRings(shape, 60, { rings: 3 });
      expect(rings, shape.kind).toBe(3);
      expect(least, shape.kind).toBeGreaterThanOrEqual(step - 1e-6);
    }
  });

  it("moves the rings a band apart, so no ring's strands reach the next's", () => {
    const { outline, step } = outlineRow(RING, 48, { ...NO_EXTRAS, rings: 3, band: 3 }, SEED);
    expect(outline.runs).toHaveLength(9);
    const means = outline.runs
      .map((run) => {
        const points = runPoints(outline.points, run);
        return points.reduce((t, p) => t + distance(p, CENTRE), 0) / points.length;
      })
      .sort((a, b) => a - b);
    for (let k = 1; k < means.length; k++) {
      expect(means[k] - means[k - 1]).toBeGreaterThan(0.8 * step);
    }
  });
});

describe("crossing a gap", () => {
  it("finds a cut between two places along a run, onward or the short way round a closed one", () => {
    // Gaps 3 round 24 points cut the steps from points 0, 8 and 16.
    const ring = { count: 24, closed: true };
    expect(crossesGapAt(ring, 3, 0, 1, "shorter")).toBe(true);
    expect(crossesGapAt(ring, 3, 0.5, 1.5, "shorter")).toBe(true);
    expect(crossesGapAt(ring, 3, 1, 2, "shorter")).toBe(false);
    expect(crossesGapAt(ring, 3, 23, 1, "onward")).toBe(true);
    expect(crossesGapAt(ring, 3, 22, 23.5, "shorter")).toBe(false);
    expect(crossesGapAt(ring, 3, 2, 1, "onward")).toBe(true);
    expect(crossesGapAt(ring, 3, 2, 1, "shorter")).toBe(false);
    expect(crossesGapAt(ring, 0, 0, 1, "onward")).toBe(false);
    expect(crossesGapAt({ count: 10, closed: false }, 1, 4, 5.5, "onward")).toBe(true);
  });
});

describe("a band at its limits", () => {
  it("leaves out the strands that would reach the centre of a coarse outline", () => {
    const triangle = { ...SHAPE_SPECS.polygon.initial, sides: 3, radius: 100 };
    // Six points round a triangle are about 87 apart; its sides are 50 from its centre.
    const { outline } = outlineRow(triangle, 6, { ...NO_EXTRAS, band: 5 }, SEED);
    expect(outline.runs).toHaveLength(3);
    for (const p of outline.points) {
      expect(distance(p, triangle.centre)).toBeGreaterThan(25);
    }
  });

  it("stops an open run's shifted strand half a step short of its end", () => {
    const line = SHAPE_SPECS.line.initial;
    const { outline, step } = outlineRow(line, 9, { ...NO_EXTRAS, band: 3 }, SEED);
    expect(outline.runs.map((run) => run.count)).toEqual([9, 8, 9]);
    const shifted = runPoints(outline.points, outline.runs[1]);
    const end = shifted[shifted.length - 1];
    expect(Math.abs(end.x - (line.b.x - step / 2))).toBeLessThanOrEqual(BAND_SCATTER * step);
  });
});

describe("Wobble in an arrange", () => {
  it("is held to the most an arrange lays", () => {
    const arranging = {
      purpose: { kind: "arrange", ids: [1, 2], lanes: "keep", alsoOuter: false },
      shape: RING,
      fill: { kind: "outline", count: 2 },
      lanes: { follow: false, mode: "off" },
      extras: { ...NO_EXTRAS, wobble: 100 },
      skipNear: false,
      seed: SEED,
      stars: { kind: "random" },
    } as const;
    expect(appliedExtras(arranging).wobble).toBe(ARRANGE_MOST_WOBBLE);
    expect(appliedExtras({ ...arranging, purpose: { kind: "add" } }).wobble).toBe(100);
  });
});
