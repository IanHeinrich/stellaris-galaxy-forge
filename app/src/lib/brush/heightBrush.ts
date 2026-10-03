import type { SystemNode } from "../../generated/SystemNode";
import type { Pt } from "../geometry/pt";
import { isFlat, relativeHeight } from "../height";
import type { SpatialGrid } from "../spatialGrid";

/** What a height stroke does to the systems under it. */
export type HeightMode = "set" | "raise" | "ripple" | "smooth";

export const HEIGHT_MODES: readonly HeightMode[] = ["set", "raise", "ripple", "smooth"];

/** A ripple's rings: crest height at the centre, the distance between crests and how fast they fade. */
export interface RippleShape {
  height: number;
  spacing: number;
  fade: number;
}

export type RipplePreset = "ripples" | "waves" | "dome" | "crater";

export const RIPPLE_PRESETS: readonly RipplePreset[] = ["ripples", "waves", "dome", "crater"];

/**
 * The shape each preset gives a brush `size` across. A dome's wave is four brushes long, so the
 * brush holds a quarter of one crest, and its fade widens with the brush so the hump stays round.
 */
export function presetShape(preset: RipplePreset, size: number): RippleShape {
  const broad = { spacing: size * 4, fade: Math.max(90, size * 2) };
  switch (preset) {
    case "ripples":
      return { height: 40, spacing: 30, fade: 60 };
    case "waves":
      return { height: 20, spacing: 90, fade: 250 };
    case "dome":
      return { height: 50, ...broad };
    case "crater":
      return { height: -45, ...broad };
  }
}

/** One height stroke's settings, all heights as the editor shows them. */
export interface HeightBrush {
  mode: HeightMode;
  /** Set: the height every system under the brush goes to. */
  value: number;
  /** Raise: how far a system at the centre rises. */
  raise: number;
  /** Smooth: the share of the way to its neighbours' mean a system at the centre moves, 0 to 1. */
  smooth: number;
  ripple: RippleShape;
  /** Alt: Raise lowers, and a ripple's crests and troughs swap. */
  flipped: boolean;
}

/** Smooth evens a system out with the systems this close to it, however small the brush. */
const SMOOTH_MIN_REACH = 30;

/** How far round a system Smooth looks for the neighbours it evens it out with. */
export function smoothReach(r: number): number {
  return Math.max(r / 3, SMOOTH_MIN_REACH);
}

/** 1 at the centre, falling to 0 at the brush's edge `r` and beyond. */
export function taper(d: number, r: number): number {
  if (r <= 0 || d >= r) return 0;
  const t = d / r;
  return 1 - t * t;
}

/** The height a ripple adds `d` from its centre, inside a brush of radius `r`. */
export function rippleAt(d: number, r: number, shape: RippleShape): number {
  const w = taper(d, r);
  if (w === 0) return 0;
  return shape.height * Math.cos((2 * Math.PI * d) / shape.spacing) * Math.exp(-d / shape.fade) * w;
}

/** How far a ripple can reach either side of the plane `d` from its centre: its rings' fade. */
export function rippleEnvelope(d: number, r: number, shape: RippleShape): number {
  return Math.abs(shape.height) * Math.exp(-d / shape.fade) * taper(d, r);
}

/** The ripple a flipped brush drops: crests and troughs swapped. */
export function flippedShape(shape: RippleShape, flipped: boolean): RippleShape {
  return flipped ? { ...shape, height: -shape.height } : shape;
}

/** A ring of a ripple: its radius, whether it rises or sinks, and how strongly, 0 to 1. */
export interface RippleRing {
  r: number;
  crest: boolean;
  strength: number;
}

/** The most rings a ripple shows, so a fine ripple in a large brush stays cheap to draw. */
const MAX_RINGS = 64;

/** The crests and troughs of a ripple inside a brush of radius `r`, the centre left out. */
export function rippleRings(r: number, shape: RippleShape): RippleRing[] {
  const top = Math.abs(shape.height);
  if (top === 0 || shape.spacing <= 0) return [];
  const half = shape.spacing / 2;
  const rings: RippleRing[] = [];
  for (let k = 1; k * half < r && rings.length < MAX_RINGS; k++) {
    const h = rippleAt(k * half, r, shape);
    if (h !== 0) rings.push({ r: k * half, crest: h > 0, strength: Math.abs(h) / top });
  }
  return rings;
}

/** What one stamp does to a system `d` from it, before the stroke's mode applies it. */
function reachOf(brush: HeightBrush, d: number, r: number): number {
  switch (brush.mode) {
    case "set":
      return d <= r ? 1 : 0;
    case "raise":
    case "smooth":
      return taper(d, r);
    case "ripple":
      return rippleAt(d, r, flippedShape(brush.ripple, brush.flipped));
  }
}

/** The heights a stroke gives the systems it moves, worked out from the heights in `systems`. */
export type HeightsOver = (systems: ReadonlyMap<number, SystemNode>) => Map<number, number>;

/** A height to the five decimals the save writes. */
function written(relative: number): number {
  return Math.round(relative * 1e5) / 1e5 || 0;
}

/**
 * One height stroke, which finds the systems under it in a galaxy fixed at its start. Each system
 * counts once however often the stroke passes it, at the strongest reach it met, so dragging back
 * and forth does not stack. A ripple drops where the first stamps land and ignores the rest.
 */
export class HeightSculpt {
  private readonly reach = new Map<number, number>();
  private dropped = false;

  constructor(
    private readonly brush: HeightBrush,
    private readonly r: number,
    private readonly systems: ReadonlyMap<number, SystemNode>,
    private readonly grid: SpatialGrid,
  ) {}

  add(stamps: readonly Pt[]): void {
    const ripple = this.brush.mode === "ripple";
    if (stamps.length === 0 || (ripple && this.dropped)) return;
    this.dropped = true;
    for (const p of stamps) {
      this.grid.forEachWithin(p.x, p.y, this.r, (s) => {
        const w = reachOf(this.brush, Math.hypot(s.x - p.x, s.y - p.y), this.r);
        if (w === 0) return;
        const had = this.reach.get(s.id);
        if (had === undefined || (ripple ? Math.abs(w) > Math.abs(had) : w > had)) {
          this.reach.set(s.id, w);
        }
      });
    }
  }

  /**
   * The height each system the stroke moves would show, applied to the heights in `systems`;
   * systems it leaves are left out.
   */
  heights(systems: ReadonlyMap<number, SystemNode> = this.systems): Map<number, number> {
    const out = new Map<number, number>();
    for (const [id, w] of this.reach) {
      const s = systems.get(id);
      if (!s) continue;
      const from = relativeHeight(s.height);
      const to = written(this.applied(s, from, w, systems));
      if (!isFlat(to - from)) out.set(id, to);
    }
    return out;
  }

  private applied(
    s: SystemNode,
    from: number,
    w: number,
    systems: ReadonlyMap<number, SystemNode>,
  ): number {
    const { mode, value, raise, smooth, flipped } = this.brush;
    switch (mode) {
      case "set":
        return value;
      case "raise":
        return from + (flipped ? -raise : raise) * w;
      case "ripple":
        return from + w;
      case "smooth": {
        const mean = this.neighbourMean(s, systems);
        return mean === null ? from : from + (mean - from) * smooth * w;
      }
    }
  }

  /** The mean height of the systems near `s`, itself left out; null when it has none. */
  private neighbourMean(s: SystemNode, systems: ReadonlyMap<number, SystemNode>): number | null {
    let sum = 0;
    let count = 0;
    this.grid.forEachWithin(s.x, s.y, smoothReach(this.r), (n) => {
      if (n.id === s.id) return;
      sum += relativeHeight(systems.get(n.id)?.height ?? n.height);
      count++;
    });
    return count === 0 ? null : sum / count;
  }
}
