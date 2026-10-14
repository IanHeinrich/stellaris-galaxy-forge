import { dist2, type Pt } from "../geometry/pt";
import { PointGrid, type Blockers } from "../placement/pointGrid";
import type { Rand } from "../random";
import type { Symmetry } from "../geometry/symmetry";
import { PoissonCore } from "../placement/poisson";

/** The most points one stroke places. */
export const SAMPLE_CAP = 1000;

export interface SamplerOptions {
  /** Stamp radius. */
  r: number;
  /** No two points, and no point and blocker, are closer than this. */
  spacing: number;
  blockers: readonly Pt[] | Blockers;
  rand: Rand;
  cap?: number;
  /** Each point is placed only where all its images fit too; the caller replicates them. */
  symmetry?: Symmetry;
}

/**
 * Bridson Poisson-disc sampling over a growing union of stamps. Each stamp is sampled as it
 * arrives, so the points depend only on the stamp sequence and the random source, never on how
 * the stamps were batched into `add` calls.
 */
export class StrokeSampler {
  private readonly r: number;
  private readonly spacing: number;
  private readonly rand: Rand;
  private readonly stamps: PointGrid;
  private readonly core: PoissonCore;

  constructor({ r, spacing, blockers, rand, cap = SAMPLE_CAP, symmetry }: SamplerOptions) {
    this.r = r;
    this.spacing = spacing;
    this.rand = rand;
    this.stamps = new PointGrid(r);
    this.core = new PoissonCore({
      spacing,
      blockers,
      rand,
      cap,
      symmetry,
      inside: (c) => this.stamps.within(c.x, c.y, r),
    });
  }

  /** Every point placed so far, in placement order. */
  get points(): readonly Pt[] {
    return this.core.points;
  }

  get full(): boolean {
    return this.core.full;
  }

  /** Samples the new stamps and returns every point placed so far. */
  add(stamps: readonly Pt[]): readonly Pt[] {
    for (const s of stamps) {
      if (this.full) break;
      this.addStamp(s);
    }
    return this.core.points;
  }

  private addStamp(s: Pt): void {
    const active = this.frontier(s);
    this.stamps.add({ x: s.x, y: s.y });
    this.core.drain(active);
    this.core.seed(() => {
      const angle = 2 * Math.PI * this.rand();
      const d = this.r * Math.sqrt(this.rand());
      return { x: s.x + d * Math.cos(angle), y: s.y + d * Math.sin(angle) };
    });
  }

  /**
   * The points whose candidate annulus reaches the new stamp, in placement order. A point whose
   * annulus lies inside one earlier stamp already had that ground to try.
   */
  private frontier(s: Pt): number[] {
    const reach = this.r + 2 * this.spacing;
    const inner = this.r - 2 * this.spacing;
    const found: number[] = [];
    this.core.someInBox(s.x - reach, s.y - reach, s.x + reach, s.y + reach, (p) => {
      if (dist2(p, s) >= reach * reach) return false;
      if (inner >= 0 && this.stamps.within(p.x, p.y, inner)) return false;
      found.push(p.i);
      return false;
    });
    return found.sort((a, b) => a - b);
  }
}
