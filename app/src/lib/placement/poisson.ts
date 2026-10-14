import type { Pt } from "../geometry/pt";
import type { Rand } from "../random";
import { copies, type Symmetry } from "../geometry/symmetry";
import { blockersOf, PointGrid, type Blockers } from "./pointGrid";
import { SymmetricSpacing } from "./symmetricSpacing";

/** Bridson's k: candidates tried about a point before it stops spawning. */
const TRIES = 30;

export interface PoissonOptions {
  /** No two points, and no point and blocker, are closer than this. */
  spacing: number;
  blockers: readonly Pt[] | Blockers;
  rand: Rand;
  cap: number;
  /** Each point is placed only where all its images fit too; the caller replicates them. */
  symmetry?: Symmetry;
  /** Whether a candidate lies in the ground being filled. */
  inside(c: Pt): boolean;
}

/** A placed point and its index in placement order. */
export interface Placed extends Pt {
  i: number;
}

/**
 * Bridson Poisson-disc sampling over ground that `inside` bounds: grows the points from an
 * active list, each new one at least `spacing` from every other point and blocker.
 */
export class PoissonCore {
  private readonly spacing: number;
  private readonly rand: Rand;
  private readonly cap: number;
  private readonly inside: (c: Pt) => boolean;
  private readonly blockers: Blockers;
  private readonly grid: PointGrid<Placed>;
  private readonly placed: Placed[] = [];
  private readonly images: SymmetricSpacing | null;

  constructor({ spacing, blockers, rand, cap, symmetry, inside }: PoissonOptions) {
    this.spacing = spacing;
    this.rand = rand;
    this.cap = cap;
    this.inside = inside;
    this.blockers = blockersOf(blockers, spacing);
    this.grid = new PointGrid(spacing);
    this.images =
      symmetry && copies(symmetry) > 1
        ? new SymmetricSpacing(symmetry, spacing, this.blockers)
        : null;
  }

  /** Every point placed so far, in placement order. */
  get points(): readonly Placed[] {
    return this.placed;
  }

  get full(): boolean {
    return this.placed.length >= this.cap;
  }

  /** Whether `test` holds for some placed point in the cells the box touches. */
  someInBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    test: (p: Placed) => boolean,
  ): boolean {
    return this.grid.someInBox(minX, minY, maxX, maxY, test);
  }

  /** Tries `candidate` up to `TRIES` times, growing from each one that fits. */
  seed(candidate: () => Pt): void {
    for (let t = 0; t < TRIES && !this.full; t++) {
      const c = candidate();
      if (this.fits(c)) this.drain([this.place(c)]);
    }
  }

  /** Spawns about the points `active` names until each has run out of room or the cap is hit. */
  drain(active: number[]): void {
    const s = this.spacing;
    while (active.length > 0 && !this.full) {
      const k = Math.floor(this.rand() * active.length);
      const p = this.placed[active[k]];
      let spawned = false;
      for (let t = 0; t < TRIES; t++) {
        const angle = 2 * Math.PI * this.rand();
        const d = s * Math.sqrt(1 + 3 * this.rand());
        const c = { x: p.x + d * Math.cos(angle), y: p.y + d * Math.sin(angle) };
        if (this.fits(c)) {
          active.push(this.place(c));
          spawned = true;
          break;
        }
      }
      if (!spawned) {
        active[k] = active[active.length - 1];
        active.pop();
      }
    }
  }

  private fits(c: Pt): boolean {
    return (
      this.inside(c) &&
      !this.grid.closerThan(c.x, c.y, this.spacing) &&
      !this.blockers.closerThan(c.x, c.y, this.spacing) &&
      (this.images?.fits(c) ?? true)
    );
  }

  /** Places `c`, which has been checked to fit, and returns its index. */
  private place(c: Pt): number {
    const i = this.placed.length;
    const p = { x: c.x, y: c.y, i };
    this.placed.push(p);
    this.grid.add(p);
    this.images?.take(c);
    return i;
  }
}
