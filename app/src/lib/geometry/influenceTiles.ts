import type { Source } from "./influenceSources";

/** World units per texel of the influence field. */
export const TEXEL = 0.5;
/** Texels along a side of a tile, the unit the field is kept and recomputed in. */
export const TILE = 64;
/** Texels along a side of a block, the unit a tile skips when it lies deep inside one owner. */
export const BLOCK = 8;
export const BLOCKS = TILE / BLOCK;

/** Owner codes: no source reaches the texel, and every unowned source together. */
export const NO_ONE = 0;
export const UNOWNED = 1;

const TILE_OFFSET = 2 ** 14;
export const TILE_SPAN = 2 ** 15;

/** The contours the field keeps: the territory's outline, and the inner edges of its band and seam. */
export const OUTLINE = 0;
export const BAND = 1;
export const SEAM = 2;
export type Contour = typeof OUTLINE | typeof BAND | typeof SEAM;
export const CONTOURS: readonly Contour[] = [OUTLINE, BAND, SEAM];
export const BANDS: readonly Contour[] = [BAND, SEAM];
/** What a block must be measured for: no contour, only a band's inner edge, or any. */
export const CLEAR = 0;
export const BANDED = 1;
export const ANY = 2;

export interface Tile {
  ti: number;
  tj: number;
  sources: Source[];
  sorted: boolean;
  /** Per texel: the three lowest influence distances, and the owner codes of the first two. */
  best: Float32Array;
  owner: Uint16Array;
  second: Float32Array;
  runner: Uint16Array;
  third: Float32Array;
  /** Per block, which contours can cross it, and how many blocks any can cross. */
  needs: Uint8Array;
  crossed: number;
  /**
   * Per contour, per owner code, the segments whose cells start in this tile: from edge, to
   * edge, from x, from y.
   */
  segments: Map<number, number[]>[];
  /**
   * Per padded texel, the band width at which it lies on its nearest owner's band's inner edge;
   * per cell, whether a band's inner edge can cross it; and per block, the range of those widths
   * over its cells. Kept from the last full trace while `limited`, as a band trace changes none.
   */
  limits: Float32Array;
  kinds: Uint8Array;
  ranges: Float32Array;
  limited: boolean;
}

export function tileKey(ti: number, tj: number): number {
  return (tj + TILE_OFFSET) * TILE_SPAN + ti + TILE_OFFSET;
}

export function newTile(ti: number, tj: number): Tile {
  return {
    ti,
    tj,
    sources: [],
    sorted: true,
    best: new Float32Array(TILE * TILE),
    owner: new Uint16Array(TILE * TILE),
    second: new Float32Array(TILE * TILE),
    runner: new Uint16Array(TILE * TILE),
    third: new Float32Array(TILE * TILE),
    needs: new Uint8Array(BLOCKS * BLOCKS),
    crossed: 0,
    segments: CONTOURS.map(() => new Map()),
    limits: new Float32Array(0),
    kinds: new Uint8Array(0),
    ranges: new Float32Array(BLOCKS * BLOCKS * 2),
    limited: false,
  };
}
