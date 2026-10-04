import { describe, expect, it } from "vitest";
import {
  HOLE_CLEARANCE,
  NAME_SPILL,
  placeLabels,
  scanPiece,
  WINDOW,
  type LabelFit,
  type LabelShape,
  type PieceScan,
} from "./labelFit";
import { inRing, type Rect } from "./polygon";
import type { Pt } from "./pt";

const ring = (...xy: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
};

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] =>
  ring(x0, y0, x1, y0, x1, y1, x0, y1);

const scanRing = (outer: Pt[], rows?: number): PieceScan => scanPiece([outer], rows);

/** The label a piece takes when it is the only one placed. */
const fitLabel = (scan: PieceScan, shape: LabelShape, maxScale: number, minScale: number) =>
  placeLabels([{ scan, shape, maxScale, minScale }])[0]!;

/** The name bar and emblem of a fitted label, the emblem reaching `drop` down into the bar. */
function rectsOf(shape: LabelShape, fit: LabelFit): Rect[] {
  const w = (shape.nameWidth * fit.scale) / 2;
  const bar = { x0: fit.x - w, y0: fit.y, x1: fit.x + w, y1: fit.y + shape.nameHeight * fit.scale };
  const e = shape.emblem * fit.scale;
  const bottom = fit.y + shape.drop * fit.scale;
  const emblem = { x0: fit.x - e / 2, y0: bottom - e, x1: fit.x + e / 2, y1: bottom };
  return e > 0 ? [bar, emblem] : [bar];
}

function labelInside(poly: Pt[], shape: LabelShape, fit: LabelFit): boolean {
  return rectsOf(shape, fit).every(({ x0, y0, x1, y1 }) =>
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ].every((p) => inRing(p, poly)),
  );
}

function overlap(a: Rect[], b: Rect[]): boolean {
  return a.some((r) => b.some((t) => r.x0 < t.x1 && t.x0 < r.x1 && r.y0 < t.y1 && t.y0 < r.y1));
}

/** A name six times as wide as it is tall, with no emblem: one solid box. */
const BAR: LabelShape = { nameWidth: 6, nameHeight: 1, emblem: 0, drop: 0 };
/** A long name with an emblem three name-heights square on top of it. */
const T: LabelShape = { nameWidth: 10, nameHeight: 1, emblem: 3, drop: 0.3 };

describe("scanPiece", () => {
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

  it("stops a line's stretches at a hole and takes the hole out of the centre of area", () => {
    const scan = scanPiece([rect(0, 0, 100, 100), rect(10, 40, 30, 60)], 10);
    expect(scan.rows[5]).toEqual([0, 10, 30, 100]);
    expect(scan.cx).toBeGreaterThan(50);
    expect(scan.cy).toBeCloseTo(50);
    expect(scan.holes).toHaveLength(1);
    expect(scan.holes[0].x).toBeCloseTo(20);
    expect(scan.holes[0].y).toBeCloseTo(50);
  });
});

/**
 * The name without the part of each end that may run past the piece, and a hair more so an
 * end that just touches the edge counts as inside.
 */
const trimmed = (shape: LabelShape): LabelShape => ({
  ...shape,
  nameWidth: shape.nameWidth - 2 * NAME_SPILL - 0.02,
});

/** The middle of a fitted label's name bar. */
const barMiddle = (shape: LabelShape, fit: LabelFit) => fit.y + (shape.nameHeight * fit.scale) / 2;

describe("placeLabels for one piece", () => {
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

  it("keeps the name near the centre of area, smaller, rather than move it to a wider base", () => {
    const tower = ring(100, 0, 300, 0, 300, 300, 400, 300, 400, 400, 0, 400, 0, 300, 100, 300);
    const scan = scanRing(tower, 48);
    const fit = fitLabel(scan, T, 100, 5);
    expect(Math.abs(barMiddle(T, fit) - scan.cy)).toBeLessThanOrEqual(WINDOW * 400);
    expect(barMiddle(T, fit)).toBeLessThan(300);
    expect(fit.x).toBeCloseTo(200, 0);
    expect(fit.scale * T.nameWidth).toBeLessThan(230);
    expect(labelInside(tower, trimmed(T), fit)).toBe(true);
  });

  it("takes the row near the centre where the name comes out largest", () => {
    const notched = ring(0, 0, 400, 0, 400, 400, 0, 400, 0, 220, 150, 220, 150, 180, 0, 180);
    const scan = scanRing(notched, 48);
    const fit = fitLabel(scan, BAR, 100, 5);
    const row = barMiddle(BAR, fit);
    expect(Math.abs(row - scan.cy)).toBeLessThanOrEqual(WINDOW * 400);
    expect(Math.abs(row - 200)).toBeGreaterThan(20);
    expect(fit.scale * BAR.nameWidth).toBeGreaterThan(350);
  });

  it("keeps the label clear of a hole", () => {
    const hole = rect(180, 180, 220, 220);
    const scan = scanPiece([rect(0, 0, 400, 400), hole], 48);
    const fit = fitLabel(scan, T, 100, 5);
    for (const { x0, y0, x1, y1 } of rectsOf(T, fit)) {
      const dx = Math.max(x0 - 200, 0, 200 - x1);
      const dy = Math.max(y0 - 200, 0, 200 - y1);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(Math.hypot(20, 20) + HOLE_CLEARANCE - 1e-9);
    }
  });

  it("slides the name off the centre just far enough to use the whole stretch", () => {
    const piece = ring(0, 0, 100, 0, 100, 100, 400, 100, 400, 200, 100, 200, 100, 300, 0, 300);
    const scan = scanRing(piece, 48);
    const fit = fitLabel(scan, BAR, 100, 5);
    const half = (fit.scale * BAR.nameWidth) / 2;
    expect(scan.cx).toBeLessThan(fit.x);
    expect(fit.x - half).toBeCloseTo(-fit.scale / 2, 0);
    expect(fit.x + half).toBeLessThanOrEqual(400 + fit.scale / 2 + 1e-9);
    expect(2 * half).toBeGreaterThan(380);
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

  it("settles every label when the floor asked for is 0", () => {
    const holed = scanPiece([rect(0, 500, 60, 560), rect(25, 525, 35, 535)]);
    const under = { ...pocket, scan: scanRing(rect(140, 40, 160, 60)), minScale: 0 };
    const [crowded, placed, left] = placeLabels([{ ...big, scan: holed, minScale: 0 }, big, under]);
    expect(crowded!.inside).toBe(false);
    expect(crowded!.scale).toBeGreaterThan(0);
    expect(placed).not.toBeNull();
    expect(left).toBeNull();
  });
});
