import type { Pt } from "./pt";

/** Horizontal lines a territory piece is sampled along to place its name. */
export const SCAN_ROWS = 24;
/** The part of a stretch's width kept clear of the piece's edge on each side. */
const SIDE_MARGIN = 0.04;
/** Blocks within this fraction of the tallest are as good, and the one nearest the middle wins. */
const TIE = 0.02;

/**
 * One territory piece cut by evenly spaced horizontal lines: what a label needs to find room
 * in it, small enough to send from the worker.
 */
export interface PieceScan {
  /** The y of the first line; line `i` lies at `y0 + i · step`. */
  y0: number;
  step: number;
  /** Each line's stretches inside the piece, as sorted `[left, right, left, right, …]`. */
  rows: number[][];
}

/** Where a label block sits and how tall it is; `inside` is false when it overflows the piece. */
export interface LabelFit {
  x: number;
  y: number;
  height: number;
  inside: boolean;
}

/** The ring sampled along `rows` lines spread evenly over its height, the ends inset by half a step. */
export function scanRing(ring: readonly Pt[], rows = SCAN_ROWS): PieceScan {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const step = (maxY - minY) / rows;
  const y0 = minY + step / 2;
  const crossings: number[][] = Array.from({ length: rows }, () => []);
  if (!(step > 0)) return { y0, step: 0, rows: [] };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    const first = Math.max(0, Math.ceil((lo - y0) / step));
    const last = Math.min(rows - 1, Math.floor((hi - y0) / step));
    for (let r = first; r <= last; r++) {
      const y = y0 + r * step;
      if (y < lo || y >= hi) continue;
      crossings[r].push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  for (const row of crossings) row.sort((p, q) => p - q);
  return { y0, step, rows: crossings };
}

/** The stretches both span lists cover. */
function intersect(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i + 1 < a.length && j + 1 < b.length) {
    const lo = Math.max(a[i], b[j]);
    const hi = Math.min(a[i + 1], b[j + 1]);
    if (hi > lo) out.push(lo, hi);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

interface Block {
  x: number;
  y: number;
  height: number;
}

/** Whether `a` is clearly taller than `b`, or as tall and nearer the piece's `middle` line. */
function beats(a: Block, b: Block, middle: number): boolean {
  if (a.height > b.height * (1 + TIE)) return true;
  return a.height >= b.height * (1 - TIE) && Math.abs(a.y - middle) < Math.abs(b.y - middle);
}

/**
 * The tallest block `aspect` times as wide as it is tall that fits inside the scanned piece,
 * no taller than `maxHeight`: a wide name lands in the piece's widest band. A block that
 * would come out shorter than `minHeight` takes that height at the same place and overflows.
 * Null for a piece with no height.
 */
export function fitLabel(
  scan: PieceScan,
  aspect: number,
  maxHeight: number,
  minHeight: number,
): LabelFit | null {
  const { rows, step, y0 } = scan;
  const middle = y0 + ((rows.length - 1) / 2) * step;
  let best: Block | null = null;
  for (let i = 0; i < rows.length; i++) {
    let spans = rows[i];
    for (let j = i + 1; j < rows.length && spans.length > 0; j++) {
      spans = intersect(spans, rows[j]);
      const tall = (j - i) * step;
      for (let k = 0; k + 1 < spans.length; k += 2) {
        const wide = (spans[k + 1] - spans[k]) * (1 - 2 * SIDE_MARGIN);
        const block = {
          x: (spans[k] + spans[k + 1]) / 2,
          y: y0 + ((i + j) / 2) * step,
          height: Math.min(tall, wide / aspect),
        };
        if (best === null || beats(block, best, middle)) best = block;
      }
    }
  }
  if (best === null) return null;
  const { x, y } = best;
  const height = Math.min(best.height, maxHeight);
  if (height < minHeight) return { x, y, height: minHeight, inside: false };
  return { x, y, height, inside: true };
}
