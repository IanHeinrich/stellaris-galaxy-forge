import type { Pt } from "../lib/geometry/pt";
import { stampsAlong } from "../lib/brush/stroke";

/** The stamps of a drag through `path`, one list per pointer move, as the brush lays them. */
export function drag(path: readonly Pt[], r: number): Pt[][] {
  let prev: Pt | null = null;
  return path.map((next) => {
    const stamps = stampsAlong(prev, next, r);
    prev = next;
    return stamps;
  });
}
