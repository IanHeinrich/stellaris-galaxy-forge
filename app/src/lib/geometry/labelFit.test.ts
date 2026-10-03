import { describe, expect, it } from "vitest";
import { fitLabel, placeLabels, scanRing, type LabelFit, type LabelShape } from "./labelFit";
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

/** The name bar and emblem of a fitted label, as `[x0, y0, x1, y1]`. */
function rectsOf(shape: LabelShape, fit: LabelFit): number[][] {
  const w = (shape.nameWidth * fit.scale) / 2;
  const bar = [fit.x - w, fit.y, fit.x + w, fit.y + shape.nameHeight * fit.scale];
  const e = shape.emblem * fit.scale;
  return e > 0 ? [bar, [fit.x - e / 2, fit.y - e, fit.x + e / 2, fit.y]] : [bar];
}

function labelInside(poly: Pt[], shape: LabelShape, fit: LabelFit): boolean {
  return rectsOf(shape, fit).every(([x0, y0, x1, y1]) =>
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].every(([x, y]) => contains(poly, x, y)),
  );
}

function overlap(a: number[][], b: number[][]): boolean {
  return a.some(([ax0, ay0, ax1, ay1]) =>
    b.some(([bx0, by0, bx1, by1]) => ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1),
  );
}

/** A name six times as wide as it is tall, with no emblem: one solid box. */
const BAR: LabelShape = { nameWidth: 6, nameHeight: 1, emblem: 0, drop: 0 };
/** A long name with an emblem three name-heights square on top of it. */
const T: LabelShape = { nameWidth: 10, nameHeight: 1, emblem: 3, drop: 0.3 };

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

  it("finds a ring's centre of area", () => {
    const scan = scanRing(rect(0, 0, 40, 20));
    expect(scan.cx).toBeCloseTo(20);
    expect(scan.cy).toBeCloseTo(10);
  });
});

/** The name with half a letter (half a font size) off each end, which may run past the piece. */
const trimmed = (shape: LabelShape): LabelShape => ({ ...shape, nameWidth: shape.nameWidth - 1 });

/** The middle of a fitted label's name bar. */
const barMiddle = (shape: LabelShape, fit: LabelFit) => fit.y + (shape.nameHeight * fit.scale) / 2;

describe("fitLabel", () => {
  it("sizes a long thin piece's name to its width, centred on it and inside it", () => {
    const strip = rect(0, 0, 300, 120);
    const fit = fitLabel(scanRing(strip), BAR, 100, 5);
    expect(fit.inside).toBe(true);
    expect(fit.x).toBeCloseTo(150, 0);
    expect(barMiddle(BAR, fit)).toBeCloseTo(60, -1);
    expect(fit.scale * BAR.nameWidth).toBeGreaterThan(280);
  });

  it("lets a centred name run a little past a narrow stretch rather than move it", () => {
    const fit = fitLabel(scanRing(rect(0, 0, 100, 400)), BAR, 100, 5);
    const width = fit.scale * BAR.nameWidth;
    expect(width).toBeGreaterThan(100);
    expect(width).toBeLessThanOrEqual(100 + fit.scale + 1e-9);
    expect(barMiddle(BAR, fit)).toBeCloseTo(200, -1);
  });

  it("hangs a tiny piece's name under an emblem on its centre, at the floor size", () => {
    const pocket = rect(0, 0, 30, 20);
    const fit = fitLabel(scanRing(pocket), T, 100, 12);
    expect(fit.inside).toBe(false);
    expect(fit.scale).toBe(12);
    expect(fit.x).toBeCloseTo(15);
    expect(fit.y - (T.emblem / 2 - T.drop) * fit.scale).toBeCloseTo(10);
  });

  it("stops a big compact piece's name at the cap", () => {
    const fit = fitLabel(scanRing(rect(0, 0, 2000, 2000)), T, 60, 5);
    expect(fit.scale).toBe(60);
    expect(fit.inside).toBe(true);
  });

  it("keeps the name on the centre's row, smaller, rather than move it to a wider lobe", () => {
    const tower = ring(100, 0, 300, 0, 300, 300, 400, 300, 400, 400, 0, 400, 0, 300, 100, 300);
    const fit = fitLabel(scanRing(tower, 48), T, 100, 5);
    expect(barMiddle(T, fit)).toBeCloseTo(230, -1);
    expect(fit.x).toBeCloseTo(200, 0);
    expect(fit.scale * T.nameWidth).toBeLessThan(230);
    expect(labelInside(tower, trimmed(T), fit)).toBe(true);
  });

  it("centres the name on the piece's centre, not on the middle of its row", () => {
    const piece = ring(0, 0, 100, 0, 100, 100, 400, 100, 400, 200, 100, 200, 100, 300, 0, 300);
    const fit = fitLabel(scanRing(piece, 48), BAR, 100, 5);
    expect(fit.x).toBeCloseTo(150, 0);
    expect(fit.scale * BAR.nameWidth).toBeLessThanOrEqual(300 + fit.scale + 1e-9);
    expect(fit.scale * BAR.nameWidth).toBeGreaterThan(250);
  });

  it("moves to the nearest room inside when the centre lies outside the piece", () => {
    const c = ring(0, 0, 300, 0, 300, 100, 100, 100, 100, 200, 300, 200, 300, 300, 0, 300);
    const fit = fitLabel(scanRing(c, 48), BAR, 100, 5);
    expect(fit.inside).toBe(true);
    expect(labelInside(c, trimmed(BAR), fit)).toBe(true);
    expect(fit.x).toBeLessThan(100);
  });
});

describe("placeLabels", () => {
  const big = { scan: scanRing(rect(0, 0, 300, 100)), shape: BAR, maxScale: 200, minScale: 10 };
  const pocket = {
    scan: scanRing(rect(100, 100, 200, 140)),
    shape: BAR,
    maxScale: 200,
    minScale: 60,
  };

  it("keeps two nearby pockets' labels apart, the larger in its own best spot", () => {
    const [first, second] = placeLabels([pocket, big]);
    expect(first && second).toBeTruthy();
    expect(overlap(rectsOf(BAR, first!), rectsOf(BAR, second!))).toBe(false);
    expect(second).toEqual(fitLabel(big.scan, big.shape, big.maxScale, big.minScale));
  });

  it("leaves out a label with no clear room even at half its floor", () => {
    const under = { ...pocket, scan: scanRing(rect(140, 40, 160, 60)), minScale: 40 };
    const [placed, left] = placeLabels([big, under]);
    expect(placed).not.toBeNull();
    expect(left).toBeNull();
  });
});
