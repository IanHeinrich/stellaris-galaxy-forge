import type { Pt } from "./pt";

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

const cache = new WeakMap<Symmetry, readonly Matrix[]>();

function matrices(sym: Symmetry): readonly Matrix[] {
  let found = cache.get(sym);
  if (!found) {
    found = build(sym);
    cache.set(sym, found);
  }
  return found;
}

function build(sym: Symmetry): Matrix[] {
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

/** Image `k` of `p`: where copy `k` puts what copy 0 has at `p`. */
export function imageOf(p: Pt, sym: Symmetry, k: number): Pt {
  return apply(matrices(sym)[k], p);
}

/** The copy that image `m` of a point in copy `k` lands in. */
export function composed(sym: Symmetry, m: number, k: number): number {
  switch (sym.kind) {
    case "off":
      return 0;
    case "mirror":
      return m ^ k;
    case "rotate":
      return (m + k) % sym.n;
  }
}

/** Each copy's stamps: element k holds copy k of every stamp, copy 0 the stamps themselves. */
export function imagesOfStamps(stamps: readonly Pt[], sym: Symmetry): Pt[][] {
  return matrices(sym).map((m) => stamps.map((p) => apply(m, p)));
}

/** The guide lines of `sym` out to `reach` from the centre: a mirror's axis, or one spoke per copy. */
export function guideLines(sym: Symmetry, reach: number): Array<[Pt, Pt]> {
  switch (sym.kind) {
    case "off":
      return [];
    case "mirror":
      return sym.axis === "x"
        ? [
            [
              { x: -reach, y: 0 },
              { x: reach, y: 0 },
            ],
          ]
        : [
            [
              { x: 0, y: -reach },
              { x: 0, y: reach },
            ],
          ];
    case "rotate":
      return matrices(sym).map((m) => [{ x: 0, y: 0 }, apply(m, { x: reach, y: 0 })]);
  }
}

/**
 * How far a system may sit from where symmetry puts an image and still stand for it: wide of
 * the file's five decimals, and of a hand-made galaxy's rounding, yet far closer than two
 * systems ever sit.
 */
export const COUNTERPART_REACH = 0.5;
