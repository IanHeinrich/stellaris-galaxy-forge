import type { Pt } from "../geometry/pt";
import { blockersOf, PointGrid, type Blockers } from "./grid";
import type { Pair } from "./lanes";

/**
 * Symmetry about the galaxy centre (0, 0), in world coordinates. Mirror axis "x" reflects across
 * the x axis (y becomes -y); axis "y" reflects across the y axis (x becomes -x). Rotation by `n`
 * gives copy k turned by k/n of a full turn, counter-clockwise in world coordinates.
 */
export type Symmetry =
  { kind: "off" } | { kind: "mirror"; axis: "x" | "y" } | { kind: "rotate"; n: 2 | 3 | 4 | 6 | 8 };

/** Row-major 2x2 matrices, copy 0 the identity. */
type Matrix = readonly [number, number, number, number];

/** Rounds to the nearest half when within float noise, so quarter and half turns are exact. */
function snap(v: number): number {
  const half = Math.round(v * 2) / 2;
  return Math.abs(v - half) < 1e-12 ? half + 0 : v;
}

function matrices(sym: Symmetry): Matrix[] {
  switch (sym.kind) {
    case "off":
      return [[1, 0, 0, 1]];
    case "mirror":
      return [[1, 0, 0, 1], sym.axis === "x" ? [1, 0, 0, -1] : [-1, 0, 0, 1]];
    case "rotate":
      return Array.from({ length: sym.n }, (_, k) => {
        const c = snap(Math.cos((2 * Math.PI * k) / sym.n));
        const s = snap(Math.sin((2 * Math.PI * k) / sym.n));
        return [c, -s, s, c] as const;
      });
  }
}

function apply([a, b, c, d]: Matrix, p: Pt): Pt {
  return { x: a * p.x + b * p.y, y: c * p.x + d * p.y };
}

/** How many copies the symmetry makes, the original included. */
export function copies(sym: Symmetry): number {
  return matrices(sym).length;
}

/** `p` and its images, `p` first. */
export function images(p: Pt, sym: Symmetry): Pt[] {
  return matrices(sym).map((m) => apply(m, p));
}

/** Each copy's stamps: element k holds copy k of every stamp, copy 0 the stamps themselves. */
export function imagesOfStamps(stamps: readonly Pt[], sym: Symmetry): Pt[][] {
  return matrices(sym).map((m) => stamps.map((p) => apply(m, p)));
}

export interface SymmetricPoints {
  /** The base points kept, in their original order. */
  base: Pt[];
  /** Copy k of `base[i]` at index `k * base.length + i`. */
  points: Pt[];
}

/**
 * Replicates `base` under `sym`, dropping any base point whose images would sit closer than
 * `spacing` to each other (near the centre or a mirror axis), to a blocker, or to an image of a
 * base point kept before it. What is kept is exactly symmetric.
 */
export function symmetricPoints(
  base: readonly Pt[],
  sym: Symmetry,
  spacing: number,
  blockers: readonly Pt[] | Blockers,
): SymmetricPoints {
  const ms = matrices(sym);
  const walls = blockersOf(blockers, spacing);
  const taken = new PointGrid(spacing);
  const kept: Pt[][] = [];
  const s2 = spacing * spacing;
  for (const p of base) {
    const imgs = ms.map((m) => apply(m, p));
    const crowded = imgs.some((q, k) =>
      imgs.some((o, j) => j > k && (o.x - q.x) ** 2 + (o.y - q.y) ** 2 < s2),
    );
    if (crowded) continue;
    if (
      imgs.some((q) => walls.near(q.x, q.y, spacing, true) || taken.near(q.x, q.y, spacing, true))
    ) {
      continue;
    }
    for (const q of imgs) taken.add(q);
    kept.push(imgs);
  }
  const points: Pt[] = [];
  for (let k = 0; k < ms.length; k++) for (const imgs of kept) points.push(imgs[k]);
  return { base: kept.map((imgs) => imgs[0]), points };
}

/**
 * Lanes between base points, given as indices into the `count` kept base points, mapped onto
 * every copy: pair [i, j] becomes [k * count + i, k * count + j] for each copy k. Deduplicated,
 * each pair smaller index first, ascending.
 */
export function symmetricPairs(pairs: readonly Pair[], count: number, sym: Symmetry): Pair[] {
  const out = new Map<string, Pair>();
  for (let k = 0; k < copies(sym); k++) {
    for (const [i, j] of pairs) {
      const a = k * count + Math.min(i, j);
      const b = k * count + Math.max(i, j);
      out.set(`${a},${b}`, [a, b]);
    }
  }
  return [...out.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
