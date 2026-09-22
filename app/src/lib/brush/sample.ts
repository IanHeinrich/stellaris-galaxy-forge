import type { Pt } from "../geometry/pt";
import { PointGrid } from "./grid";
import type { Rand } from "./random";

/** The most points one stroke places. */
export const SAMPLE_CAP = 1000;

/** Bridson's k: candidates tried about a point before it stops spawning. */
export const TRIES = 30;

export interface SamplerOptions {
  /** Stamp radius. */
  r: number;
  /** No two points, and no point and blocker, are closer than this. */
  spacing: number;
  blockers: readonly Pt[];
  rand: Rand;
  cap?: number;
}

interface Placed extends Pt {
  i: number;
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
  private readonly cap: number;
  private readonly blockers: PointGrid;
  private readonly stamps: PointGrid;
  private readonly grid: PointGrid<Placed>;
  private readonly placed: Placed[] = [];

  constructor({ r, spacing, blockers, rand, cap = SAMPLE_CAP }: SamplerOptions) {
    this.r = r;
    this.spacing = spacing;
    this.rand = rand;
    this.cap = cap;
    this.blockers = new PointGrid(spacing);
    for (const b of blockers) this.blockers.add(b);
    this.stamps = new PointGrid(r);
    this.grid = new PointGrid(spacing);
  }

  /** Every point placed so far, in placement order. */
  get points(): readonly Pt[] {
    return this.placed;
  }

  get full(): boolean {
    return this.placed.length >= this.cap;
  }

  /** Samples the new stamps and returns every point placed so far. */
  add(stamps: readonly Pt[]): readonly Pt[] {
    for (const s of stamps) {
      if (this.full) break;
      this.addStamp(s);
    }
    return this.placed;
  }

  private addStamp(s: Pt): void {
    const active = this.frontier(s);
    this.stamps.add({ x: s.x, y: s.y });
    this.drain(active);
    for (let t = 0; t < TRIES && !this.full; t++) {
      const angle = 2 * Math.PI * this.rand();
      const d = this.r * Math.sqrt(this.rand());
      const c = { x: s.x + d * Math.cos(angle), y: s.y + d * Math.sin(angle) };
      if (this.fits(c)) this.drain([this.place(c)]);
    }
  }

  /**
   * The points whose candidate annulus reaches the new stamp, in placement order. A point whose
   * annulus lies inside one earlier stamp already had that ground to try.
   */
  private frontier(s: Pt): number[] {
    const reach = this.r + 2 * this.spacing;
    const inner = this.r - 2 * this.spacing;
    const found: number[] = [];
    this.grid.someInBox(s.x - reach, s.y - reach, s.x + reach, s.y + reach, (p) => {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      if (dx * dx + dy * dy >= reach * reach) return false;
      if (inner >= 0 && this.stamps.near(p.x, p.y, inner)) return false;
      found.push(p.i);
      return false;
    });
    return found.sort((a, b) => a - b);
  }

  private drain(active: number[]): void {
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
      this.stamps.near(c.x, c.y, this.r) &&
      !this.grid.near(c.x, c.y, this.spacing, true) &&
      !this.blockers.near(c.x, c.y, this.spacing, true)
    );
  }

  private place(c: Pt): number {
    const i = this.placed.length;
    const p = { x: c.x, y: c.y, i };
    this.placed.push(p);
    this.grid.add(p);
    return i;
  }
}

/** The points a whole stroke places at once: the same as feeding its stamps to a `StrokeSampler`. */
export function sampleStroke(
  stamps: readonly Pt[],
  r: number,
  spacing: number,
  blockers: readonly Pt[],
  rand: Rand,
  cap = SAMPLE_CAP,
): Pt[] {
  const sampler = new StrokeSampler({ r, spacing, blockers, rand, cap });
  return sampler.add(stamps).map(({ x, y }) => ({ x, y }));
}
