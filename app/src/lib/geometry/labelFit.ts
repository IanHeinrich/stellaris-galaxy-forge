import type { Pt } from "./pt";

/** Horizontal lines a territory piece is sampled along to place its name. */
export const SCAN_ROWS = 24;
/** The part of a stretch's width kept clear of the piece's edge on each side. */
const SIDE_MARGIN = 0.04;
/** Blocks within this fraction of each other's height share a rank. */
const TIE = 0.02;
/**
 * A label at least this share of the largest that fits is as good, and the one nearest the
 * piece's centre of area wins; this settles big pieces, where many spots reach the cap.
 */
const NEAR_BEST = 0.95;

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
  /** The piece's centre of area, which the game centres a label on when it has room there. */
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
}

/** A piece's label to place: its scan, its shape, and the scales it may take. */
export interface LabelRequest {
  scan: PieceScan;
  shape: LabelShape;
  maxScale: number;
  minScale: number;
}

/** A label at (`x`, `y`), the top middle of its name bar, at `scale`. */
interface Spot {
  x: number;
  y: number;
  scale: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How many separate spots in its piece a crowded label tries before it shrinks. */
const SPOTS = 12;
/** A label that does not fit its emblem shrinks by this step at a time; so does a crowded one. */
const SHRINK_STEP = 0.85;
/** The share of its floor a crowded label may shrink to before it is left out. */
const SHRINK_LIMIT = 0.5;

/** Scales within `TIE` of each other share a rank. */
function rankOf(scale: number): number {
  return scale > 0 ? Math.floor(Math.log(scale) / Math.log(1 + TIE)) : -Infinity;
}

/** The name bar and the emblem square of a label at `spot`. */
function rectsOf(shape: LabelShape, { x, y, scale }: Spot): Rect[] {
  const w = (shape.nameWidth * scale) / 2;
  const bar = { x0: x - w, y0: y, x1: x + w, y1: y + shape.nameHeight * scale };
  if (shape.emblem <= 0) return [bar];
  const e = shape.emblem * scale;
  return [bar, { x0: x - e / 2, y0: y - e, x1: x + e / 2, y1: y }];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Where along `[lo, hi]` the middle of a bar `width` wide may sit with an emblem `side` wide
 * centred on it fitting the stretches of every line from `top - side` to `top`, nearest `cx`;
 * null when there is no such place. An emblem reaching past the piece's first line does not fit.
 */
function emblemX(
  scan: PieceScan,
  lo: number,
  hi: number,
  width: number,
  side: number,
  top: number,
): number | null {
  const { rows, step, y0, cx } = scan;
  let allowed = [lo + width / 2, hi - width / 2];
  if (allowed[0] > allowed[1]) return null;
  if (side > 0) {
    const first = Math.ceil((top - side - y0) / step);
    const last = Math.floor((top - y0) / step);
    if (first < 0) return null;
    let room = [lo, hi];
    for (let r = first; r <= last && room.length > 0; r++) room = intersect(room, rows[r]);
    const centres: number[] = [];
    for (let k = 0; k + 1 < room.length; k += 2) {
      const a = Math.max(room[k] + side / 2, allowed[0]);
      const b = Math.min(room[k + 1] - side / 2, allowed[1]);
      if (a <= b) centres.push(a, b);
    }
    allowed = centres;
  }
  let best: number | null = null;
  for (let k = 0; k + 1 < allowed.length; k += 2) {
    const x = Math.min(allowed[k + 1], Math.max(allowed[k], cx));
    if (best === null || Math.abs(x - cx) < Math.abs(best - cx)) best = x;
  }
  return best;
}

/**
 * Up to `SPOTS` places in the scanned piece for a label of `shape`, best first. The name bar
 * fits the stretches of the lines it spans and the emblem those of the lines above its middle,
 * so a long name runs along a thin band while its emblem rises into the room above. Spots whose
 * scale, capped at `maxScale`, is at least `NEAR_BEST` of the largest come first, nearest the
 * piece's centre of area first; the rest follow, largest first. A spot that overlaps a better
 * one is skipped.
 */
function spotsIn(scan: PieceScan, shape: LabelShape, maxScale: number): Spot[] {
  const { rows, step, y0, cx, cy } = scan;
  const all: Spot[] = [];
  let largest = 0;
  for (let i = 0; i < rows.length; i++) {
    let spans = rows[i];
    for (let j = i + 1; j < rows.length && spans.length > 0; j++) {
      spans = intersect(spans, rows[j]);
      const tall = (j - i) * step;
      for (let k = 0; k + 1 < spans.length; k += 2) {
        const margin = (spans[k + 1] - spans[k]) * SIDE_MARGIN;
        const lo = spans[k] + margin;
        const hi = spans[k + 1] - margin;
        const fits = Math.min(tall / shape.nameHeight, (hi - lo) / shape.nameWidth, maxScale);
        for (let scale = fits; scale > fits * SHRINK_LIMIT; scale *= SHRINK_STEP) {
          const top = y0 + i * step + (tall - shape.nameHeight * scale) / 2;
          const nameWidth = shape.nameWidth * scale;
          const x = emblemX(scan, lo, hi, nameWidth, shape.emblem * scale, top);
          if (x === null) continue;
          all.push({ x, y: top, scale });
          largest = Math.max(largest, scale);
          break;
        }
      }
    }
  }
  const centreOf = (s: Spot) => s.y + (shape.nameHeight * s.scale) / 2;
  const near = (s: Spot) => (s.scale >= largest * NEAR_BEST ? 0 : 1);
  const off = (s: Spot) => Math.hypot(s.x - cx, centreOf(s) - cy);
  all.sort(
    (a, b) =>
      near(a) - near(b) ||
      (near(a) === 0 ? 0 : rankOf(b.scale) - rankOf(a.scale)) ||
      off(a) - off(b) ||
      a.x - b.x,
  );
  const spots: Spot[] = [];
  for (const spot of all) {
    if (spots.length === SPOTS) break;
    const [bar] = rectsOf(shape, spot);
    if (!spots.some((s) => overlaps(bar, rectsOf(shape, s)[0]))) spots.push(spot);
  }
  return spots;
}

/** `spot` at `scale`, its name bar's middle kept where it was. */
function rescaled(shape: LabelShape, spot: Spot, scale: number): Spot {
  if (scale === spot.scale) return spot;
  const middle = spot.y + (shape.nameHeight * spot.scale) / 2;
  return { x: spot.x, y: middle - (shape.nameHeight * scale) / 2, scale };
}

/**
 * The largest label of `shape` that fits inside the scanned piece, no larger than `maxScale`.
 * A label that would come out smaller than `minScale` takes that scale at the same place and
 * overflows. Null for a piece with no height.
 */
export function fitLabel(
  scan: PieceScan,
  shape: LabelShape,
  maxScale: number,
  minScale: number,
): LabelFit | null {
  const [best] = spotsIn(scan, shape, maxScale);
  if (best === undefined) return null;
  if (best.scale >= minScale) return { ...best, inside: true };
  return { ...rescaled(shape, best, minScale), inside: false };
}

/**
 * Every label fitted to its piece with no two overlapping. The largest go first, each at its
 * best spot. A label that would overlap one already placed tries its piece's other spots, then
 * shrinks step by step at each of them down to half its floor, and is left out (null) if it
 * still finds no clear room. The same requests always give the same placements.
 */
export function placeLabels(requests: readonly LabelRequest[]): (LabelFit | null)[] {
  const spots = requests.map((r) => spotsIn(r.scan, r.shape, r.maxScale));
  const planned = requests.map((r, i) => Math.max(spots[i][0]?.scale ?? 0, r.minScale));
  const order = requests
    .map((_, i) => i)
    .filter((i) => spots[i].length > 0)
    .sort(
      (a, b) =>
        planned[b] * requests[b].shape.nameWidth - planned[a] * requests[a].shape.nameWidth ||
        a - b,
    );
  const placed: Rect[] = [];
  const out: (LabelFit | null)[] = requests.map(() => null);
  for (const i of order) {
    const { shape, minScale } = requests[i];
    const tryAt = (spot: Spot, scale: number): boolean => {
      const at = rescaled(shape, spot, scale);
      const rects = rectsOf(shape, at);
      if (rects.some((r) => placed.some((p) => overlaps(r, p)))) return false;
      placed.push(...rects);
      out[i] = { ...at, inside: scale <= spot.scale };
      return true;
    };
    if (spots[i].some((spot) => tryAt(spot, Math.max(spot.scale, minScale)))) continue;
    for (let s = planned[i] * SHRINK_STEP; s >= minScale * SHRINK_LIMIT; s *= SHRINK_STEP) {
      if (spots[i].some((spot) => tryAt(spot, Math.min(s, Math.max(spot.scale, minScale))))) break;
    }
  }
  return out;
}
