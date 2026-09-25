import type { Pt } from "../lib/geometry/pt";
import { SAMPLE_CAP, StrokeSampler } from "../lib/brush/sample";
import { stampsAlong } from "../lib/brush/stroke";
import type { Rand } from "../lib/random";

/** The stamps of a drag through `path`, one list per pointer move, as the brush lays them. */
export function drag(path: readonly Pt[], r: number): Pt[][] {
  let prev: Pt | null = null;
  return path.map((next) => {
    const stamps = stampsAlong(prev, next, r);
    prev = next;
    return stamps;
  });
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
