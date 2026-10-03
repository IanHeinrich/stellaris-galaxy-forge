import { describe, expect, it } from "vitest";
import { fitLabel, scanRing, type LabelFit } from "./labelFit";
import type { Pt } from "./pt";

const ring = (...xy: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
};

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] =>
  ring(x0, y0, x1, y0, x1, y1, x0, y1);

/** Whether (`x`, `y`) lies inside `poly`, by ray crossing. */
function contains(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function blockInside(poly: Pt[], fit: LabelFit, aspect: number): boolean {
  const hw = (fit.height * aspect) / 2;
  const hh = fit.height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].every(([dx, dy]) => contains(poly, fit.x + dx, fit.y + dy));
}

const ASPECT = 6;

describe("scanRing", () => {
  it("lists each line's stretches inside the ring, left to right", () => {
    const u = ring(0, 0, 30, 0, 30, 100, 20, 100, 20, 10, 10, 10, 10, 100, 0, 100);
    const scan = scanRing(u, 10);
    expect(scan.rows[0]).toEqual([0, 30]);
    expect(scan.rows[5]).toEqual([0, 10, 20, 30]);
  });

  it("has no lines for a ring with no height", () => {
    expect(scanRing(ring(0, 0, 10, 0, 20, 0)).rows).toEqual([]);
  });
});

describe("fitLabel", () => {
  it("fits a long thin piece's name to its width, smaller than the cap and inside it", () => {
    const strip = rect(0, 0, 300, 120);
    const fit = fitLabel(scanRing(strip), ASPECT, 100, 5)!;
    expect(fit.inside).toBe(true);
    expect(fit.height).toBeLessThan(100);
    expect(fit.height).toBeGreaterThan(40);
    expect(blockInside(strip, fit, ASPECT)).toBe(true);
  });

  it("gives a tiny piece the floor size, centred on it and overflowing", () => {
    const pocket = rect(0, 0, 30, 20);
    const fit = fitLabel(scanRing(pocket), ASPECT, 100, 12)!;
    expect(fit.inside).toBe(false);
    expect(fit.height).toBe(12);
    expect(fit.x).toBeCloseTo(15, 0);
    expect(fit.y).toBeCloseTo(10, 0);
  });

  it("stops a big compact piece's name at the cap", () => {
    const fit = fitLabel(scanRing(rect(0, 0, 2000, 2000)), ASPECT, 60, 5)!;
    expect(fit.height).toBe(60);
    expect(fit.inside).toBe(true);
  });

  it("puts the name in an L's wide arm, not at the corner", () => {
    const l = ring(0, 0, 400, 0, 400, 60, 60, 60, 60, 400, 0, 400);
    const fit = fitLabel(scanRing(l, 48), ASPECT, 100, 5)!;
    expect(fit.y).toBeLessThan(60);
    expect(fit.x).toBeGreaterThan(120);
    expect(blockInside(l, fit, ASPECT)).toBe(true);
  });

  it("puts the name in a dumbbell's wide lobe, not at the narrow join", () => {
    const lobe = ring(
      ...[0, 0, 100, 0, 100, 45, 160, 45, 160, 0, 460, 0, 460, 100],
      ...[160, 100, 160, 55, 100, 55, 100, 100, 0, 100],
    );
    const fit = fitLabel(scanRing(lobe, 40), ASPECT, 100, 5)!;
    expect(fit.x).toBeGreaterThan(160);
    expect(blockInside(lobe, fit, ASPECT)).toBe(true);
  });
});
