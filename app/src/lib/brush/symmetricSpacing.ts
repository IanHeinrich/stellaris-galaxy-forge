import { images, type Symmetry } from "../geometry/symmetry";
import type { Pt } from "../geometry/pt";
import { PointGrid, type Blockers } from "./grid";

/**
 * Keeps a growing symmetric set of points spaced. A point fits when its images sit at least
 * `spacing` from each other (so none crowds the centre or a mirror axis), from every blocker,
 * and from every image taken before, so what is taken stays exactly symmetric.
 */
export class SymmetricSpacing {
  private readonly taken: PointGrid;
  private readonly s2: number;

  constructor(
    private readonly sym: Symmetry,
    private readonly spacing: number,
    private readonly blockers: Blockers,
  ) {
    this.taken = new PointGrid(spacing);
    this.s2 = spacing * spacing;
  }

  fits(p: Pt): boolean {
    const imgs = images(p, this.sym);
    for (let k = 0; k < imgs.length; k++) {
      const q = imgs[k];
      for (let j = k + 1; j < imgs.length; j++) {
        if ((imgs[j].x - q.x) ** 2 + (imgs[j].y - q.y) ** 2 < this.s2) return false;
      }
      if (this.blockers.near(q.x, q.y, this.spacing, true)) return false;
      if (this.taken.near(q.x, q.y, this.spacing, true)) return false;
    }
    return true;
  }

  /** Takes `p` and its images, which the caller has checked fit. */
  take(p: Pt): void {
    for (const q of images(p, this.sym)) this.taken.add(q);
  }
}
