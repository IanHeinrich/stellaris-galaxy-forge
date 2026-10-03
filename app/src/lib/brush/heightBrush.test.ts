import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { systemNode } from "../../test/builders";
import { absoluteHeight } from "../height";
import { SpatialGrid } from "../spatialGrid";
import {
  HeightSculpt,
  presetShape,
  rippleAt,
  rippleRings,
  taper,
  type HeightBrush,
} from "./heightBrush";

const BRUSH: HeightBrush = {
  mode: "raise",
  value: 30,
  raise: 10,
  smooth: 1,
  ripple: { height: 40, spacing: 30, fade: 60 },
  flipped: false,
};

/** Systems along y = 0 at each x, with the shown heights given, none above the plane by default. */
function row(xs: number[], heights: number[] = []): SystemNode[] {
  return xs.map((x, i) => systemNode({ id: i + 1, x, height: absoluteHeight(heights[i] ?? 0) }));
}

function sculpt(brush: Partial<HeightBrush>, systems: SystemNode[], r = 20): HeightSculpt {
  const grid = new SpatialGrid();
  grid.build(systems);
  return new HeightSculpt({ ...BRUSH, ...brush }, r, new Map(systems.map((s) => [s.id, s])), grid);
}

describe("the height brush's profile", () => {
  it("tapers to nothing at the brush edge", () => {
    expect(taper(0, 20)).toBe(1);
    expect(taper(10, 20)).toBeCloseTo(0.75);
    expect(taper(20, 20)).toBe(0);
    expect(taper(25, 20)).toBe(0);
  });

  it("drops a ripple whose crests and troughs alternate every half wave, fading out", () => {
    const shape = { height: 40, spacing: 30, fade: 60 };
    expect(rippleAt(0, 100, shape)).toBeCloseTo(40);
    expect(rippleAt(15, 100, shape)).toBeLessThan(0);
    expect(rippleAt(30, 100, shape)).toBeGreaterThan(0);
    expect(rippleAt(30, 100, shape)).toBeLessThan(rippleAt(0, 100, shape));
    expect(rippleAt(100, 100, shape)).toBe(0);

    const rings = rippleRings(100, shape);
    expect(rings.map((ring) => ring.r)).toEqual([15, 30, 45, 60, 75, 90]);
    expect(rings.map((ring) => ring.crest)).toEqual([false, true, false, true, false, true]);
    expect(rings[0].strength).toBeGreaterThan(rings[2].strength);
  });

  it("makes Dome one hump and Crater one bowl, whatever the brush size", () => {
    for (const size of [10, 40, 400]) {
      const r = size / 2;
      const dome = presetShape("dome", size);
      const crater = presetShape("crater", size);
      for (let d = 1; d < r; d += r / 20) {
        expect(rippleAt(d, r, dome)).toBeLessThanOrEqual(rippleAt(d - 1, r, dome));
        expect(rippleAt(d, r, crater)).toBeGreaterThanOrEqual(rippleAt(d - 1, r, crater));
      }
      expect(rippleRings(r, dome)).toEqual([]);
    }
  });
});

describe("a height stroke", () => {
  it("raises most at the centre and nothing at the edge, and Alt lowers", () => {
    const systems = row([0, 10, 20], [5]);
    const raise = sculpt({}, systems);
    raise.add([{ x: 0, y: 0 }]);
    expect([...raise.heights()]).toEqual([
      [1, 15],
      [2, 7.5],
    ]);

    const lower = sculpt({ flipped: true }, systems);
    lower.add([{ x: 0, y: 0 }]);
    expect(lower.heights().get(1)).toBe(-5);
  });

  it("counts each system once, at the strongest reach the stroke met", () => {
    const s = sculpt({}, row([0]));
    for (let i = 0; i < 5; i++)
      s.add([
        { x: 10, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]);
    expect(s.heights().get(1)).toBe(10);
  });

  it("sets every system under the brush to the height, leaving those already there", () => {
    const s = sculpt({ mode: "set", value: 30 }, row([0, 15, 40], [0, 30]));
    s.add([{ x: 0, y: 0 }]);
    expect([...s.heights()]).toEqual([[1, 30]]);
  });

  it("drops a ripple once, where the stroke began, and Alt flips it", () => {
    const systems = row([0, 15, 60]);
    const s = sculpt({ mode: "ripple" }, systems, 100);
    s.add([{ x: 0, y: 0 }]);
    s.add([{ x: 60, y: 0 }]);
    const heights = s.heights();
    expect(heights.get(1)).toBe(40);
    expect(heights.get(2)).toBeLessThan(0);
    expect(heights.get(3)).toBeCloseTo(rippleAt(60, 100, BRUSH.ripple), 1);

    const flipped = sculpt({ mode: "ripple", flipped: true }, systems, 100);
    flipped.add([{ x: 0, y: 0 }]);
    expect(flipped.heights().get(1)).toBe(-40);
  });

  it("moves a system at the brush's rim a little with the stroke, never snapped against it", () => {
    const s = sculpt({}, row([19.98], [3.12]));
    s.add([{ x: 0, y: 0 }]);
    expect(s.heights().get(1)).toBeGreaterThan(3.12);
    expect(s.heights().get(1)).toBeCloseTo(3.14, 2);
  });

  it("works out a stroke's heights from the heights it is applied to", () => {
    const s = sculpt({}, row([0]));
    s.add([{ x: 0, y: 0 }]);
    const raised = row([0], [10]);
    expect(s.heights(new Map(raised.map((n) => [n.id, n]))).get(1)).toBe(20);
    expect(s.heights().get(1)).toBe(10);
  });

  it("smooths a system toward the mean of its neighbours", () => {
    const s = sculpt({ mode: "smooth", smooth: 0.5 }, row([0, 20, -20], [40, 10, 0]), 60);
    s.add([{ x: 0, y: 0 }]);
    const heights = s.heights();
    expect(heights.get(1)).toBe(40 + (5 - 40) * 0.5);
    expect(heights.get(2)).toBeGreaterThan(10);

    const gentle = sculpt({ mode: "smooth", smooth: 0.001 }, row([0, 20, -20], [40, 10, 0]), 60);
    gentle.add([{ x: 0, y: 0 }]);
    expect(gentle.heights().get(1)).toBeCloseTo(40 - 35 * 0.001, 5);
  });
});
