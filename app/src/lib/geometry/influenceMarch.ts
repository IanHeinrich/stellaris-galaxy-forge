import * as contour from "./contour";
import * as smoothing from "./influenceSmoothing";
import * as tiling from "./influenceTiles";
import type { Contour, Tile } from "./influenceTiles";

// Bound once: under Vitest every read of an imported name is a getter call, too slow per texel.
const { CASES, edgeId, SADDLES } = contour;
const { CORNER_RISE, DEPTH_BLEND, depthReach, EDGE, HARD_SLACK, MAX_BAND_DEPTH } = smoothing;
const { SLOPE_BLEND_SHARE, smoothMax, smoothMin } = smoothing;
const { BLOCK, BLOCKS, CLEAR, CONTOURS, NO_ONE, OUTLINE, TEXEL, TILE, TILE_SPAN } = tiling;

/** A tile and two texels of its neighbours right and below: a corner's slope reads one further. */
const PAD = TILE + 2;
/** What a cell is to the bands: out of their reach, held by one owner, or shared by several. */
const OUTSIDE = 0;
const INSIDE = 1;
const MIXED = 2;
/** How far, as a share, a width must be from a cell's limits for them to settle its corners' sides. */
const LIMIT_MARGIN = 1e-4;

type Texels = Float32Array | Uint16Array;

/** Traces a tile's contours from the texels the raster measured, by marching squares. */
export class InfluenceMarch {
  private readonly padBest = new Float32Array(PAD * PAD);
  private readonly padSecond = new Float32Array(PAD * PAD);
  private readonly padThird = new Float32Array(PAD * PAD);
  private readonly padOwner = new Uint16Array(PAD * PAD);
  private readonly padRunner = new Uint16Array(PAD * PAD);
  /** Per padded texel, φ of its nearest owner without the rounding, and with it, and its slope. */
  private readonly padHard = new Float32Array(PAD * PAD);
  private readonly padPhi = new Float32Array(PAD * PAD);
  private readonly padSlope = new Float32Array(PAD * PAD);
  /** Per contour, per padded texel, the value its nearest owner's contour is traced on. */
  private readonly padValues = CONTOURS.map(() => new Float64Array(PAD * PAD));
  /** Arrays for a march to remember each owner's φ and slope per texel in. */
  private readonly spare: Float32Array[] = [];

  /**
   * `widths` is the band width each contour runs at, `none` the influence distance of an owner
   * no source of which reaches, and `lone` how steeply φ falls round a lone owned system.
   */
  constructor(
    private readonly tiles: ReadonlyMap<number, Tile>,
    private readonly widths: readonly number[],
    private readonly none: number,
    private readonly lone: number,
  ) {}

  /**
   * Marching squares over the cells whose top-left texel is in the tile, for each drawn owner and
   * each of `contours`: the outline, or a band's inner edge at that contour's width. The segments
   * of each owner code, by contour.
   */
  march(
    tile: Tile,
    key: number,
    contours: readonly Contour[],
    drawn: Uint8Array,
  ): Map<number, number[]>[] {
    const best = this.padBest;
    const second = this.padSecond;
    const third = this.padThird;
    const owner = this.padOwner;
    const runner = this.padRunner;
    this.pad(tile, key);
    const outs: Map<number, number[]>[] = [];
    for (const c of contours) outs[c] = new Map();
    const widths = this.widths;
    const lone = this.lone;
    const slopeBlend = lone * SLOPE_BLEND_SHARE;
    const gi0 = tile.ti * TILE;
    const gj0 = tile.tj * TILE;
    const phiOf = (q: number, c: number): number => {
      let d: number;
      let other: number;
      if (owner[q] === c) {
        d = best[q];
        other = smoothMin(second[q], third[q]);
      } else if (runner[q] === c) {
        d = second[q];
        other = smoothMin(best[q], third[q]);
      } else {
        d = third[q];
        other = smoothMin(best[q], second[q]);
      }
      return smoothMax(d - other, d - EDGE);
    };
    const memo = new Map<number, Float32Array[]>();
    const arraysOf = (c: number): Float32Array[] => {
      let arrays = memo.get(c);
      if (!arrays) {
        arrays = [
          this.spare.pop() ?? new Float32Array(PAD * PAD),
          this.spare.pop() ?? new Float32Array(PAD * PAD),
        ];
        arrays[0].fill(NaN);
        arrays[1].fill(NaN);
        memo.set(c, arrays);
      }
      return arrays;
    };
    // A texel's own owner's φ and slope are kept in flat arrays, any other owner's by owner.
    const nearestPhi = this.padPhi;
    const nearestSlope = this.padSlope;
    nearestPhi.fill(NaN);
    nearestSlope.fill(NaN);
    const phiAt = (q: number, c: number): number => {
      const phi = owner[q] === c ? nearestPhi : arraysOf(c)[0];
      let v = phi[q];
      if (v !== v) v = phi[q] = Math.fround(phiOf(q, c));
      return v;
    };
    const slopeAt = (q: number, c: number, v: number): number => {
      const slope = owner[q] === c ? nearestSlope : arraysOf(c)[1];
      let s = slope[q];
      if (s !== s) {
        const dx = phiAt(q + 1, c) - v;
        const dy = phiAt(q + PAD, c) - v;
        const steep = Math.sqrt(dx * dx + dy * dy) / TEXEL;
        s = slope[q] = Math.fround(smoothMax(steep, lone, slopeBlend));
      }
      return s;
    };
    const valueAt = (q: number, c: number, w: number): number => {
      const v = phiAt(q, c);
      if (w === 0) return v;
      return v + smoothMin(w * slopeAt(q, c, v), MAX_BAND_DEPTH, DEPTH_BLEND);
    };
    const values = this.padValues;
    for (const k of contours) values[k].fill(NaN);
    const valueOf = (q: number, c: number, k: Contour): number => {
      if (owner[q] !== c) return valueAt(q, c, widths[k]);
      const memo = values[k];
      let v = memo[q];
      if (v !== v) v = memo[q] = valueAt(q, c, widths[k]);
      return v;
    };
    const cell = (k: Contour, c: number, i: number, j: number, q: number): void => {
      const v0 = valueOf(q, c, k);
      const v1 = valueOf(q + 1, c, k);
      const v2 = valueOf(q + PAD + 1, c, k);
      const v3 = valueOf(q + PAD, c, k);
      const index = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
      if (index === 0 || index === 15) return;
      let cases = CASES[index];
      if (index === 5 || index === 10) {
        const joined = v0 + v1 + v2 + v3 < 0;
        cases = SADDLES[index === 5 ? (joined ? 0 : 1) : joined ? 2 : 3];
      }
      const out = outs[k];
      let list = out.get(c);
      if (!list) out.set(c, (list = []));
      const gi = gi0 + i;
      const gj = gj0 + j;
      for (let n = 0; n < cases.length; n += 2) {
        const a = cases[n];
        list.push(edgeId(a, gi, gj), edgeId(cases[n + 1], gi, gj));
        if (a === 0) list.push((gi + 0.5 + v0 / (v0 - v1)) * TEXEL, (gj + 0.5) * TEXEL);
        else if (a === 1) list.push((gi + 1.5) * TEXEL, (gj + 0.5 + v1 / (v1 - v2)) * TEXEL);
        else if (a === 2) list.push((gi + 0.5 + v3 / (v3 - v2)) * TEXEL, (gj + 1.5) * TEXEL);
        else list.push((gi + 0.5) * TEXEL, (gj + 0.5 + v0 / (v0 - v3)) * TEXEL);
      }
    };
    /** Traces the cell for each drawn owner at its corners, once each. */
    const shared = (k: Contour, i: number, j: number, q: number): void => {
      const a = owner[q];
      const b = owner[q + 1];
      const c = owner[q + PAD + 1];
      const d = owner[q + PAD];
      if (drawn[a]) cell(k, a, i, j, q);
      if (drawn[b] && b !== a) cell(k, b, i, j, q);
      if (drawn[c] && c !== a && c !== b) cell(k, c, i, j, q);
      if (drawn[d] && d !== a && d !== b && d !== c) cell(k, d, i, j, q);
    };
    const hard = this.padHard;
    const outline = contours.includes(OUTLINE);
    const bands = contours.filter((c) => c !== OUTLINE);
    const banded = bands.length > 0;
    if (banded && (outline || !tile.limited)) this.limit(tile, phiAt, slopeAt, drawn);
    else if (outline) tile.limited = false;
    const { limits, kinds, ranges } = tile;
    const live: Contour[] = [];
    for (let block = 0; block < BLOCKS * BLOCKS; block++) {
      if (tile.needs[block] === CLEAR) continue;
      live.length = 0;
      if (banded) {
        const low = ranges[2 * block] * (1 - LIMIT_MARGIN);
        const high = ranges[2 * block + 1] * (1 + LIMIT_MARGIN);
        for (const k of bands) if (widths[k] >= low && widths[k] <= high) live.push(k);
      }
      if (live.length === 0 && !outline) continue;
      const i0 = (block % BLOCKS) * BLOCK;
      const j0 = Math.floor(block / BLOCKS) * BLOCK;
      for (let j = j0; j < j0 + BLOCK; j++) {
        for (let i = i0; i < i0 + BLOCK; i++) {
          const q = j * PAD + i;
          // Past every owner's edge at all four corners, every φ is positive; and the outline
          // keeps clear of a cell whose hard φ is further from 0 than the rounding moves it.
          if (outline && nearEdge(best, q)) {
            const a = owner[q];
            if (a === owner[q + 1] && a === owner[q + PAD + 1] && a === owner[q + PAD]) {
              if (drawn[a] && cornerHardRange(hard, q, -CORNER_RISE)) cell(OUTLINE, a, i, j, q);
            } else {
              shared(OUTLINE, i, j, q);
            }
          }
          if (live.length === 0) continue;
          const kind = kinds[j * TILE + i];
          if (kind === MIXED) {
            for (const k of live) shared(k, i, j, q);
            continue;
          }
          if (kind !== INSIDE) continue;
          const l0 = limits[q];
          const l1 = limits[q + 1];
          const l2 = limits[q + PAD];
          const l3 = limits[q + PAD + 1];
          const low = Math.min(l0, l1, l2, l3) * (1 - LIMIT_MARGIN);
          const high = Math.max(l0, l1, l2, l3) * (1 + LIMIT_MARGIN);
          for (const k of live) {
            if (widths[k] >= low && widths[k] <= high) cell(k, owner[q], i, j, q);
          }
        }
      }
    }
    for (const arrays of memo.values()) this.spare.push(...arrays);
    return outs;
  }

  /**
   * Finds, for every cell a band's inner edge can cross, the band width at which each corner
   * lies on that edge, and each block's range of them, so a new width re-traces only the cells
   * it falls among.
   */
  private limit(
    tile: Tile,
    phiAt: (q: number, c: number) => number,
    slopeAt: (q: number, c: number, v: number) => number,
    drawn: Uint8Array,
  ): void {
    const { padBest: best, padOwner: owner, padHard: hard } = this;
    if (tile.limits.length === 0) {
      tile.limits = new Float32Array(PAD * PAD);
      tile.kinds = new Uint8Array(TILE * TILE);
    }
    const { limits, kinds, ranges } = tile;
    limits.fill(NaN);
    kinds.fill(OUTSIDE);
    const limitAt = (q: number, c: number): number => {
      let l = limits[q];
      if (l !== l) {
        const v = phiAt(q, c);
        const reach = depthReach(-v);
        l = limits[q] =
          reach === 0 || reach === Infinity ? reach : Math.fround(reach / slopeAt(q, c, v));
      }
      return l;
    };
    const deepest = -(MAX_BAND_DEPTH + CORNER_RISE);
    for (let block = 0; block < BLOCKS * BLOCKS; block++) {
      let low = Infinity;
      let high = -Infinity;
      if (tile.needs[block] !== CLEAR) {
        const i0 = (block % BLOCKS) * BLOCK;
        const j0 = Math.floor(block / BLOCKS) * BLOCK;
        for (let j = j0; j < j0 + BLOCK; j++) {
          for (let i = i0; i < i0 + BLOCK; i++) {
            const q = j * PAD + i;
            if (!nearEdge(best, q)) continue;
            const a = owner[q];
            const b = owner[q + 1];
            const c = owner[q + PAD + 1];
            const d = owner[q + PAD];
            if (a !== b || a !== c || a !== d) {
              if (drawn[a] || drawn[b] || drawn[c] || drawn[d]) {
                kinds[j * TILE + i] = MIXED;
                low = -Infinity;
                high = Infinity;
              }
              continue;
            }
            if (!drawn[a] || !cornerHardRange(hard, q, deepest)) continue;
            kinds[j * TILE + i] = INSIDE;
            const l0 = limitAt(q, a);
            const l1 = limitAt(q + 1, a);
            const l2 = limitAt(q + PAD, a);
            const l3 = limitAt(q + PAD + 1, a);
            low = Math.min(low, l0, l1, l2, l3);
            high = Math.max(high, l0, l1, l2, l3);
          }
        }
      }
      ranges[2 * block] = low;
      ranges[2 * block + 1] = high;
    }
    tile.limited = true;
  }

  /** Copies the tile and the first two columns and rows of its neighbours right and below into the pad. */
  private pad(tile: Tile, key: number): void {
    const right = this.tiles.get(key + 1);
    const below = this.tiles.get(key + TILE_SPAN);
    const corner = this.tiles.get(key + TILE_SPAN + 1);
    const none = this.none;
    padLayer(this.padBest, tile.best, right?.best, below?.best, corner?.best, none);
    padLayer(this.padSecond, tile.second, right?.second, below?.second, corner?.second, none);
    padLayer(this.padThird, tile.third, right?.third, below?.third, corner?.third, none);
    padLayer(this.padOwner, tile.owner, right?.owner, below?.owner, corner?.owner, NO_ONE);
    padLayer(this.padRunner, tile.runner, right?.runner, below?.runner, corner?.runner, NO_ONE);
    const { padBest, padSecond, padHard } = this;
    for (let q = 0; q < PAD * PAD; q++) {
      padHard[q] = Math.max(padBest[q] - padSecond[q], padBest[q] - EDGE);
    }
  }
}

/** Whether any corner of the cell from padded texel `q` lies within `EDGE` of its nearest owner. */
function nearEdge(best: Float32Array, q: number): boolean {
  return (
    best[q] <= EDGE || best[q + 1] <= EDGE || best[q + PAD] <= EDGE || best[q + PAD + 1] <= EDGE
  );
}

/**
 * Whether the hard φ at the corners of the cell from padded texel `q` reaches `low` at its
 * highest and `HARD_SLACK` at its lowest, so a contour between them can cross the cell.
 */
function cornerHardRange(hard: Float32Array, q: number, low: number): boolean {
  const h0 = hard[q];
  const h1 = hard[q + 1];
  const h2 = hard[q + PAD];
  const h3 = hard[q + PAD + 1];
  return Math.max(h0, h1, h2, h3) >= low && Math.min(h0, h1, h2, h3) <= HARD_SLACK;
}

/** One layer of a tile and its neighbours' first two columns and rows, or `empty` where there is no neighbour. */
function padLayer(
  pad: Texels,
  own: Texels,
  right: Texels | undefined,
  below: Texels | undefined,
  corner: Texels | undefined,
  empty: number,
): void {
  for (let j = 0; j < TILE; j++) {
    const from = j * TILE;
    const to = j * PAD;
    pad.set(own.subarray(from, from + TILE), to);
    pad[to + TILE] = right ? right[from] : empty;
    pad[to + TILE + 1] = right ? right[from + 1] : empty;
  }
  for (let j = TILE; j < PAD; j++) {
    const from = (j - TILE) * TILE;
    const to = j * PAD;
    if (below) pad.set(below.subarray(from, from + TILE), to);
    else pad.fill(empty, to, to + TILE);
    pad[to + TILE] = corner ? corner[from] : empty;
    pad[to + TILE + 1] = corner ? corner[from + 1] : empty;
  }
}
