import { dist2, type Pt } from "../geometry/pt";
import {
  composed,
  copies,
  COUNTERPART_REACH,
  imageOf,
  type NearestIndex,
  type Symmetry,
} from "../geometry/symmetry";
import type { ImageOfNew } from "./ground";
import { PointGrid } from "./pointGrid";

export interface SymmetricCopies {
  /** `base` in order, then each later copy's kept images, copy by copy. */
  points: Pt[];
  /** The base point and copy each of `points` was made as. */
  made: ReadonlyArray<readonly [number, number]>;
  imageOfNew: ImageOfNew;
}

interface Kept extends Pt {
  j: number;
}

/**
 * `base` and its images under `sym`, so that copy k of base point i is `points[k * n + i]`
 * when every image is kept. An image within reach of a point already kept merges into it, as
 * one on the pivot or a mirror axis does, and one where `occupied` has a system is left out.
 * The base points are always kept.
 */
export function symmetricCopies(
  base: readonly Pt[],
  sym: Symmetry,
  occupied?: NearestIndex,
): SymmetricCopies {
  const points: Pt[] = [];
  const grid = new PointGrid<Kept>(COUNTERPART_REACH);
  /** `at[i][k]`: the index of copy k of base point i; null where it was left out. */
  const at = base.map((): Array<number | null> => []);
  /** The base point and copy each kept point was made as. */
  const made: Array<[number, number]> = [];
  for (let k = 0; k < copies(sym); k++) {
    base.forEach((p, i) => {
      const q = imageOf(p, sym, k);
      if (k > 0) {
        const merged = keptWithin(grid, q);
        if (merged !== null) {
          at[i][k] = merged;
          return;
        }
        if (occupied?.nearestSystem(q.x, q.y, COUNTERPART_REACH)) {
          at[i][k] = null;
          return;
        }
      }
      const j = points.push(q) - 1;
      grid.add({ x: q.x, y: q.y, j });
      made.push([i, k]);
      at[i][k] = j;
    });
  }
  return {
    points,
    made,
    imageOfNew: (j, m) => {
      const [i, k] = made[j];
      return at[i][composed(sym, m, k)];
    },
  };
}

/** A kept point within `COUNTERPART_REACH` of `q`, by index; null for none. */
function keptWithin(grid: PointGrid<Kept>, q: Pt): number | null {
  const r = COUNTERPART_REACH;
  let found: number | null = null;
  grid.someInBox(q.x - r, q.y - r, q.x + r, q.y + r, (p) => {
    if (dist2(p, q) >= r * r) return false;
    found = p.j;
    return true;
  });
  return found;
}
