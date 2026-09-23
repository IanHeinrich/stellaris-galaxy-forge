import type { Pt } from "./pt";

/**
 * Symmetry about the galaxy centre (0, 0), in world coordinates. Mirror axis "x" reflects across
 * the x axis (y becomes -y); axis "y" reflects across the y axis (x becomes -x). Rotation by `n`
 * gives copy k turned by k/n of a full turn, counter-clockwise in world coordinates.
 */
export type Symmetry =
  { kind: "off" } | { kind: "mirror"; axis: SymmetryAxis } | { kind: "rotate"; n: RotationOrder };

export type SymmetryAxis = "x" | "y";

export const ROTATION_ORDERS = [2, 3, 4, 6, 8] as const;

export type RotationOrder = (typeof ROTATION_ORDERS)[number];

/** Whether two symmetries are the same kind with the same axis or order. */
export function sameSymmetry(a: Symmetry, b: Symmetry): boolean {
  const key = (s: Symmetry) => `${s.kind}:${"axis" in s ? s.axis : ""}:${"n" in s ? s.n : ""}`;
  return key(a) === key(b);
}

/** A symmetry that makes copies. */
export type ActiveSymmetry = Exclude<Symmetry, { kind: "off" }>;

/** Whether `value`, read back from storage, is a symmetry. */
export function isSymmetry(value: unknown): value is Symmetry {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  switch (s.kind) {
    case "off":
      return true;
    case "mirror":
      return s.axis === "x" || s.axis === "y";
    case "rotate":
      return ROTATION_ORDERS.some((n) => n === s.n);
    default:
      return false;
  }
}

/** Row-major 2x2 matrices, copy 0 the identity. */
type Matrix = readonly [number, number, number, number];

/** Rounds to the nearest half when within float noise, so quarter and half turns are exact. */
function snap(v: number): number {
  const half = Math.round(v * 2) / 2;
  return Math.abs(v - half) < 1e-12 ? half + 0 : v;
}

interface Group {
  matrices: readonly Matrix[];
  /** `products[m][k]`: the copy whose matrix is copy m's times copy k's. */
  products: readonly (readonly number[])[];
}

const cache = new WeakMap<Symmetry, Group>();

function group(sym: Symmetry): Group {
  let found = cache.get(sym);
  if (!found) {
    const matrices = build(sym);
    const products = matrices.map((m) =>
      matrices.map((k) => {
        const mk = times(m, k);
        return matrices.findIndex((j) => j.every((v, i) => Math.abs(v - mk[i]) < 1e-9));
      }),
    );
    found = { matrices, products };
    cache.set(sym, found);
  }
  return found;
}

function matrices(sym: Symmetry): readonly Matrix[] {
  return group(sym).matrices;
}

function times([a, b, c, d]: Matrix, [e, f, g, h]: Matrix): Matrix {
  return [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
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
  return group(sym).products[m][k];
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

/** What finds the nearest of its points to a place, as the spatial grid does. */
export interface NearestIndex {
  nearestSystem(x: number, y: number, maxDist: number): { id: number } | null;
}

/** The point of `index` standing for image `k` of `p`, by its id; null where none does. */
export function counterpartAt(index: NearestIndex, p: Pt, sym: Symmetry, k: number): number | null {
  const q = imageOf(p, sym, k);
  return index.nearestSystem(q.x, q.y, COUNTERPART_REACH)?.id ?? null;
}
