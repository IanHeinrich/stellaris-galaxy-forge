import type { BrushSettings } from "../lib/brush/brushStroke";
import { DEFAULT_LANE_DENSITY } from "../lib/geometry/mesh";
import { dist2, type Pt } from "../lib/geometry/pt";
import { SAMPLE_CAP } from "../lib/placement/limits";
import { StrokeSampler } from "../lib/brush/sample";
import { stampsAlong } from "../lib/brush/stroke";
import type { Rand } from "../lib/random";

/** A paint brush 40 across with every other option at a plain value, for a test to change what it tests. */
export const BRUSH_SETTINGS: BrushSettings = {
  tool: "paint",
  size: 40,
  spacing: 10,
  laneMode: "nearby",
  eraseTarget: "systems",
  eraseSpecials: false,
  symmetry: { kind: "off" },
  laneDensity: DEFAULT_LANE_DENSITY,
  laneIslands: false,
  height: {
    mode: "raise",
    value: 0,
    raise: 10,
    smooth: 0.5,
    ripple: { height: 40, spacing: 30, fade: 60 },
    flipped: false,
  },
  spread: { strength: 0.5, specials: false, gather: false, edge: null, gap: 0, kept: new Set() },
};

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

/** Whether `p` lies in the union of the discs of radius `r` about the stamps, edge included. */
export function inStroke(p: Pt, stamps: readonly Pt[], r: number): boolean {
  const r2 = r * r;
  return stamps.some((s) => dist2(s, p) <= r2);
}
