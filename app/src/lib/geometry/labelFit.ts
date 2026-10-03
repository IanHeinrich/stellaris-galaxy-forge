import type { Pt } from "./pt";

/** Horizontal lines a territory piece is sampled along to place its name. */
export const SCAN_ROWS = 24;
/**
 * How far either end of a name may run past the edge of its stretch, in units of scale (font
 * sizes), about half a letter: in the game the first letter of a name centred on its territory
 * can reach over the border.
 */
const NAME_SPILL = 0.5;
/** The share of the emblem's width and height that may poke past the piece. */
const EMBLEM_OVERHANG = 0.1;
/** The step a label's scale is tried down by while it does not fit. */
const SCALE_STEP = 0.95;

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
  /** The piece's centre of area, which the game centres a label on. */
  cx: number;
  cy: number;
}

/**
 * Where a label sits: (`x`, `y`) is the top middle of its name bar, the emblem above it, and
 * `scale` multiplies its shape. `inside` is false when it overflows its piece.
 */
export interface LabelFit {
  x: number;
  y: number;
  scale: number;
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
  const { cx, cy } = centreOfArea(ring);
  if (!(step > 0)) return { y0, step: 0, rows: [], cx, cy };
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
  return { y0, step, rows: crossings, cx, cy };
}

/** The centroid of the ring's area; the mean of its points when it has none. */
function centreOfArea(ring: readonly Pt[]): { cx: number; cy: number } {
  let area = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    sx += (a.x + b.x) * cross;
    sy += (a.y + b.y) * cross;
  }
  if (area !== 0) return { cx: sx / (3 * area), cy: sy / (3 * area) };
  const n = Math.max(ring.length, 1);
  return {
    cx: ring.reduce((s, p) => s + p.x, 0) / n,
    cy: ring.reduce((s, p) => s + p.y, 0) / n,
  };
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

/**
 * A label's parts per unit of scale, as the game lays them out: a wide, short name bar, and the
 * emblem, a square `emblem` on a side (0 for none), centred on top of the bar.
 */
export interface LabelShape {
  nameWidth: number;
  nameHeight: number;
  emblem: number;
  /** How far the emblem reaches down into the top of the name's line, above its letters. */
  drop: number;
}

/** A piece's label to place: its scan, its shape, and the scales it may take. */
export interface LabelRequest {
  scan: PieceScan;
  shape: LabelShape;
  maxScale: number;
  minScale: number;
}

/**
 * A place for a label. With `hang` false, (`x`, `y`) is the middle of the name bar; with
 * `hang` true it is the emblem's centre and the name hangs below it. `scale` is the largest
 * that fits there, 0 for a piece too small for the floor.
 */
interface Spot {
  x: number;
  y: number;
  scale: number;
  hang: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How many places in its piece a crowded label tries before it shrinks. */
const SPOTS = 12;
/** A crowded label shrinks by this step at a time. */
const SHRINK_STEP = 0.85;
/** The share of its floor a crowded label may shrink to before it is left out. */
const SHRINK_LIMIT = 0.5;

/** The label of `shape` placed at `spot` at `scale`. */
function placed(shape: LabelShape, spot: Spot, scale: number): LabelFit {
  const top = spot.hang
    ? spot.y + ((shape.emblem / 2 - shape.drop) * scale)
    : spot.y - (shape.nameHeight * scale) / 2;
  return { x: spot.x, y: top, scale, inside: scale <= spot.scale };
}

/** The name bar and the emblem square of a placed label. */
function rectsOf(shape: LabelShape, { x, y, scale }: LabelFit): Rect[] {
  const w = (shape.nameWidth * scale) / 2;
  const bar = { x0: x - w, y0: y, x1: x + w, y1: y + shape.nameHeight * scale };
  if (shape.emblem <= 0) return [bar];
  const e = shape.emblem * scale;
  const bottom = y + shape.drop * scale;
  return [bar, { x0: x - e / 2, y0: bottom - e, x1: x + e / 2, y1: bottom }];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * The stretches every line from `top` to `bottom` has in common, or the nearest line's when
 * none lies between; null when the band reaches past the piece's first or last line by more
 * than half a step.
 */
function stretchesOver(scan: PieceScan, top: number, bottom: number): number[] | null {
  const { rows, step, y0 } = scan;
  if (top < y0 - step / 2 || bottom > y0 + (rows.length - 0.5) * step) return null;
  const first = Math.max(0, Math.ceil((top - y0) / step));
  const last = Math.min(rows.length - 1, Math.floor((bottom - y0) / step));
  if (first > last) {
    const nearest = ((top + bottom) / 2 - y0) / step;
    return rows[Math.min(rows.length - 1, Math.max(0, Math.round(nearest)))];
  }
  let room = rows[first];
  for (let r = first + 1; r <= last && room.length > 0; r++) room = intersect(room, rows[r]);
  return room;
}

/** The stretch holding `x`, or with `nearest` the one closest to it; null when there is none. */
function stretchAt(room: readonly number[], x: number, nearest: boolean): [number, number] | null {
  let best: [number, number] | null = null;
  let gap = Infinity;
  for (let k = 0; k + 1 < room.length; k += 2) {
    const d = x < room[k] ? room[k] - x : x > room[k + 1] ? x - room[k + 1] : 0;
    if (d < gap) {
      gap = d;
      best = [room[k], room[k + 1]];
    }
  }
  return gap === 0 || nearest ? best : null;
}

/** Whether an emblem `side` wide, centred on `x` and resting on `top`, lies mostly inside. */
function emblemFits(scan: PieceScan, x: number, side: number, top: number): boolean {
  const inset = (side * (1 - EMBLEM_OVERHANG)) / 2;
  const room = stretchesOver(scan, top - 2 * inset, top);
  if (room === null) return false;
  for (let k = 0; k + 1 < room.length; k += 2) {
    if (room[k] <= x - inset && x + inset <= room[k + 1]) return true;
  }
  return false;
}

/**
 * The largest label, from `maxScale` down to `minScale`, whose name bar is centred on the row
 * at `y`, with neither end of the name more than `NAME_SPILL` past the edge of its stretch and
 * the emblem mostly inside above it. On the centre of area's row (`centred`) the name is
 * centred on the centre itself, which must lie in the piece; on another row it is centred on
 * the stretch nearest the centre. Null when even `minScale` does not fit.
 */
function fitAt(
  scan: PieceScan,
  shape: LabelShape,
  y: number,
  maxScale: number,
  minScale: number,
  centred: boolean,
): Spot | null {
  for (let scale = maxScale; scale >= minScale; scale *= SCALE_STEP) {
    const half = (shape.nameHeight * scale) / 2;
    const room = stretchesOver(scan, y - half, y + half);
    const stretch = room && stretchAt(room, scan.cx, !centred);
    if (!stretch) continue;
    const [a, b] = stretch;
    const x = centred ? scan.cx : (a + b) / 2;
    const reach = (shape.nameWidth / 2 - NAME_SPILL) * scale;
    if (x - reach < a || x + reach > b) continue;
    const top = y - half + shape.drop * scale;
    if (shape.emblem > 0 && !emblemFits(scan, x, shape.emblem * scale, top)) continue;
    return { x, y, scale, hang: false };
  }
  return null;
}

/**
 * Where a label of `shape` may go in the scanned piece, best first. The game centres a label on
 * its piece: the name bar's row is the centre of area's, and the label takes the largest scale
 * that fits there, smaller rather than moved. Only when the centre lies outside the piece, or
 * the label there would be under `minScale`, do the other rows follow, nearest first. A piece
 * too small for the floor anywhere hangs its name under an emblem on the centre of area; that
 * place comes last for every piece, for a crowded label.
 */
function spotsIn(scan: PieceScan, shape: LabelShape, maxScale: number, minScale: number): Spot[] {
  const { rows, step, y0, cx, cy } = scan;
  const spots: Spot[] = [];
  const add = (spot: Spot | null) => {
    if (spot === null || spots.length >= SPOTS) return;
    const [bar] = rectsOf(shape, placed(shape, spot, spot.scale));
    const clash = spots.some((s) => overlaps(bar, rectsOf(shape, placed(shape, s, s.scale))[0]));
    if (!clash) spots.push(spot);
  };
  if (rows.length > 0) {
    add(fitAt(scan, shape, cy, maxScale, minScale, true));
    const others = rows.map((_, i) => y0 + i * step);
    others.sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy) || a - b);
    for (const y of others) add(fitAt(scan, shape, y, maxScale, minScale, false));
  }
  spots.push({ x: cx, y: cy, scale: 0, hang: shape.emblem > 0 });
  return spots;
}

/**
 * The label of `shape` the scanned piece takes on its own: centred on the piece, as large as
 * fits there up to `maxScale`. A piece with no room for `minScale` takes that scale with the
 * emblem on its centre and the name hanging below, overflowing.
 */
export function fitLabel(
  scan: PieceScan,
  shape: LabelShape,
  maxScale: number,
  minScale: number,
): LabelFit {
  const [best] = spotsIn(scan, shape, maxScale, minScale);
  return placed(shape, best, Math.max(best.scale, minScale));
}

/**
 * Every label fitted to its piece with no two overlapping. The largest go first, each at its
 * best place. A label that would overlap one already placed tries its piece's other places,
 * then shrinks step by step at each of them down to half its floor, and is left out (null) if
 * it still finds no clear room. The same requests always give the same placements.
 */
export function placeLabels(requests: readonly LabelRequest[]): (LabelFit | null)[] {
  const spots = requests.map((r) => spotsIn(r.scan, r.shape, r.maxScale, r.minScale));
  const planned = requests.map((r, i) => Math.max(spots[i][0].scale, r.minScale));
  const width = (i: number) => planned[i] * requests[i].shape.nameWidth;
  const order = requests.map((_, i) => i).sort((a, b) => width(b) - width(a) || a - b);
  const taken: Rect[] = [];
  const out: (LabelFit | null)[] = requests.map(() => null);
  for (const i of order) {
    const { shape, minScale } = requests[i];
    const tryAt = (spot: Spot, scale: number): boolean => {
      const fit = placed(shape, spot, scale);
      const rects = rectsOf(shape, fit);
      if (rects.some((r) => taken.some((t) => overlaps(r, t)))) return false;
      taken.push(...rects);
      out[i] = fit;
      return true;
    };
    if (spots[i].some((spot) => tryAt(spot, Math.max(spot.scale, minScale)))) continue;
    for (let s = planned[i] * SHRINK_STEP; s >= minScale * SHRINK_LIMIT; s *= SHRINK_STEP) {
      if (spots[i].some((spot) => tryAt(spot, Math.min(s, Math.max(spot.scale, minScale))))) {
        break;
      }
    }
  }
  return out;
}
