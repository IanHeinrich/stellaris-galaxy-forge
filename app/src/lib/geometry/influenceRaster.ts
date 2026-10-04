import * as smoothing from "./influenceSmoothing";
import * as sources from "./influenceSources";
import type { Source } from "./influenceSources";
import * as tiling from "./influenceTiles";
import type { Tile } from "./influenceTiles";

// Bound once: under Vitest every read of an imported name is a getter call, too slow per texel.
const { CORNER_RISE, EDGE, MAX_BAND_DEPTH } = smoothing;
const { bySource, FALLOFF_STEPS, pointSegmentDist2, SOFTNESS } = sources;
const { ANY, BANDED, BLOCK, BLOCKS, CLEAR, NO_ONE, TEXEL, TILE } = tiling;

/**
 * From a block's centre to the farthest texel an edge of one of its texels reaches, in texels:
 * the field changes too little over that distance to cross a contour when the centre is clear of one.
 */
const BLOCK_REACH = Math.hypot(BLOCK / 2 + 0.5, BLOCK / 2 - 0.5);
const BLOCK_RADIUS = Math.SQRT2 * ((BLOCK - 1) / 2) * TEXEL;

/** Measures a tile's texels: the three lowest influence distances at each and whose they are. */
export class InfluenceRaster {
  private readonly table: Float64Array;
  /** How far an owner's influence can change from a block's centre to any texel its cells reach. */
  private readonly drift: number;
  private readonly near: Source[] = [];
  private readonly acc = new Float64Array(BLOCK * BLOCK);
  private readonly outBest = new Float32Array(BLOCK * BLOCK);
  private readonly outSecond = new Float32Array(BLOCK * BLOCK);
  private readonly outThird = new Float32Array(BLOCK * BLOCK);
  private readonly outOwner = new Uint16Array(BLOCK * BLOCK);
  private readonly outRunner = new Uint16Array(BLOCK * BLOCK);

  /**
   * `none` is the influence distance of an owner no source of which reaches, and `unit` the
   * smallest radius or thickness of any source.
   */
  constructor(
    private readonly none: number,
    unit: number,
  ) {
    const size = Math.ceil((none / SOFTNESS) * FALLOFF_STEPS) + 2;
    this.table = Float64Array.from({ length: size }, (_, i) => Math.exp(-i / FALLOFF_STEPS));
    // A smooth minimum of distances over radii changes by at most 1/unit per world unit.
    this.drift = ((BLOCK_REACH * TEXEL) / Math.max(unit, 1e-6)) * 1.001 + 0.005;
  }

  /** Recomputes every texel of the tile, a whole block at once where its centre is clear of any border. */
  raster(tile: Tile, drawn: Uint8Array): void {
    if (!tile.sorted) {
      tile.sources.sort(bySource);
      tile.sorted = true;
    }
    const near = this.near;
    const reachPad = BLOCK_RADIUS;
    tile.crossed = 0;
    for (let bj = 0; bj < BLOCKS; bj++) {
      for (let bi = 0; bi < BLOCKS; bi++) {
        const x0 = (tile.ti * TILE + bi * BLOCK + 0.5) * TEXEL;
        const y0 = (tile.tj * TILE + bj * BLOCK + 0.5) * TEXEL;
        const cx = x0 + ((BLOCK - 1) / 2) * TEXEL;
        const cy = y0 + ((BLOCK - 1) / 2) * TEXEL;
        near.length = 0;
        for (const s of tile.sources) {
          const r = s.reach + reachPad;
          if (pointSegmentDist2(cx, cy, s) <= r * r) near.push(s);
        }
        const first = (bj * BLOCK * TILE + bi * BLOCK) | 0;
        this.measure(near, cx, cy, 1, TEXEL);
        const need = this.need(this.outBest[0], this.outOwner[0], this.outSecond[0], drawn);
        tile.needs[bj * BLOCKS + bi] = need;
        tile.crossed += need === CLEAR ? 0 : 1;
        if (need === CLEAR) {
          this.fillBlock(tile, first);
          continue;
        }
        if (need === BANDED && this.coarse(tile, near, x0, y0, first)) continue;
        this.measure(near, x0, y0, BLOCK, TEXEL);
        for (let j = 0; j < BLOCK; j++) {
          const row = first + j * TILE;
          const from = j * BLOCK;
          tile.best.set(this.outBest.subarray(from, from + BLOCK), row);
          tile.second.set(this.outSecond.subarray(from, from + BLOCK), row);
          tile.third.set(this.outThird.subarray(from, from + BLOCK), row);
          tile.owner.set(this.outOwner.subarray(from, from + BLOCK), row);
          tile.runner.set(this.outRunner.subarray(from, from + BLOCK), row);
        }
      }
    }
  }

  /**
   * Which contours can pass within `BLOCK_REACH` of a point with these values: none, when every
   * owner's φ stays above 0 there or the owner's own stays below the deepest band; only a band's
   * inner edge, when the owner holds the whole block and its outline stays clear; or any.
   */
  private need(best: number, owner: number, second: number, drawn: Uint8Array): number {
    const drift = this.drift;
    if (best - EDGE > drift) return CLEAR;
    if (!drawn[owner]) {
      return second - best > 2 * drift || second - EDGE > drift ? CLEAR : ANY;
    }
    const deep = MAX_BAND_DEPTH + CORNER_RISE;
    if (second - best > 2 * drift + deep && EDGE - best > drift + deep) return CLEAR;
    if (second - best > 2 * drift + CORNER_RISE && EDGE - best > drift + CORNER_RISE) return BANDED;
    return ANY;
  }

  /**
   * Measures the block on every second texel and fills the rest in between, where only a band's
   * inner edge can pass and the field is smooth enough for that; false, measuring nothing, when
   * the owner does not hold every measured texel after all.
   */
  private coarse(tile: Tile, near: Source[], x0: number, y0: number, first: number): boolean {
    const n = BLOCK / 2 + 1;
    this.measure(near, x0, y0, n, 2 * TEXEL);
    const { outBest, outSecond, outThird, outOwner, outRunner } = this;
    const code = outOwner[0];
    for (let q = 1; q < n * n; q++) if (outOwner[q] !== code) return false;
    for (let j = 0; j < BLOCK; j++) {
      const gj = j >> 1;
      const fy = (j & 1) / 2;
      for (let i = 0; i < BLOCK; i++) {
        const gi = i >> 1;
        const fx = (i & 1) / 2;
        const a = gj * n + gi;
        const q = first + j * TILE + i;
        tile.best[q] = bilinear(outBest, a, n, fx, fy);
        tile.second[q] = bilinear(outSecond, a, n, fx, fy);
        tile.third[q] = bilinear(outThird, a, n, fx, fy);
        tile.owner[q] = code;
        tile.runner[q] = outRunner[a];
      }
    }
    return true;
  }

  /** Fills the block from `first` with the values measured at its centre. */
  private fillBlock(tile: Tile, first: number): void {
    const { best, second, third, owner, runner } = tile;
    const b = this.outBest[0];
    const s = this.outSecond[0];
    const t = this.outThird[0];
    const o = this.outOwner[0];
    const r = this.outRunner[0];
    for (let j = 0; j < BLOCK; j++) {
      const row = first + j * TILE;
      for (let q = row; q < row + BLOCK; q++) {
        best[q] = b;
        second[q] = s;
        third[q] = t;
        owner[q] = o;
        runner[q] = r;
      }
    }
  }

  /** The three best influences over an n×n grid of texels from (x0, y0), into the `out` arrays. */
  private measure(list: Source[], x0: number, y0: number, n: number, step: number): void {
    const { acc, table, outBest, outSecond, outThird, outOwner, outRunner } = this;
    const cells = n * n;
    outBest.fill(this.none, 0, cells);
    outSecond.fill(this.none, 0, cells);
    outThird.fill(this.none, 0, cells);
    outOwner.fill(NO_ONE, 0, cells);
    outRunner.fill(NO_ONE, 0, cells);
    let g = 0;
    while (g < list.length) {
      const code = list[g].code;
      acc.fill(0, 0, cells);
      for (; g < list.length && list[g].code === code; g++) {
        const { ax, ay, dx, dy, invLen2, scale, limit } = list[g];
        for (let j = 0; j < n; j++) {
          const ry = y0 + j * step - ay;
          const row = j * n;
          for (let i = 0; i < n; i++) {
            const rx = x0 + i * step - ax;
            let t = (rx * dx + ry * dy) * invLen2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = rx - t * dx;
            const ey = ry - t * dy;
            const u = Math.sqrt(ex * ex + ey * ey) * scale;
            if (u >= limit) continue;
            const k = u | 0;
            acc[row + i] += table[k] + (table[k + 1] - table[k]) * (u - k);
          }
        }
      }
      for (let q = 0; q < cells; q++) {
        const a = acc[q];
        if (a <= 0) continue;
        const v = -SOFTNESS * Math.log(a);
        if (v < outBest[q]) {
          outThird[q] = outSecond[q];
          outSecond[q] = outBest[q];
          outRunner[q] = outOwner[q];
          outBest[q] = v;
          outOwner[q] = code;
        } else if (v < outSecond[q]) {
          outThird[q] = outSecond[q];
          outSecond[q] = v;
          outRunner[q] = code;
        } else if (v < outThird[q]) {
          outThird[q] = v;
        }
      }
    }
  }
}

/** The value a share `fx` and `fy` of the way from grid point `a` of an n-wide grid to the next. */
function bilinear(values: Float32Array, a: number, n: number, fx: number, fy: number): number {
  const top = values[a] + (values[a + 1] - values[a]) * fx;
  const bottom = values[a + n] + (values[a + n + 1] - values[a + n]) * fx;
  return top + (bottom - top) * fy;
}
