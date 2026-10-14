import type { Pt } from "../geometry/pt";
import { seeded, type Rand } from "../random";
import { pointDraws } from "./fills";
import { distance, lerp, type ShapeFrame } from "./frame";
import { joined, oneRun, outlineStep, runPoints } from "./outline";
import { centreOf, specOf } from "./specs";
import type {
  ExtraKey,
  FillKind,
  Outline,
  PendingShape,
  Shape,
  ShapeCentre,
  ShapeExtras,
  ShapePurpose,
  ShapeSettings,
  SpokeEnds,
} from "./types";

/** One extra's row: how the options panel shows it, and what it changes. */
export interface ExtraRow {
  label: string;
  /** What it does to the shape, for its tooltip. */
  hint: string;
  range: { min: number; max: number };
  step: number;
  /** Shown after the number: "" or "%". */
  unit: string;
  /** The fills it changes. */
  fills: readonly FillKind[];
  /** Whether it changes an arrange too; Band and Rings lay more points than the selection holds. */
  arranges: boolean;
  /** Whether it changes only follow lanes, and so only with Follow the shape on. */
  followOnly: boolean;
}

/** Every extra that is a number, in the options panel's order. */
export const EXTRA_ROWS: Record<ExtraKey, ExtraRow> = {
  band: {
    label: "Band",
    hint: "Draw the outline several systems thick.",
    range: { min: 1, max: 5 },
    step: 1,
    unit: "",
    fills: ["outline"],
    arranges: false,
    followOnly: false,
  },
  rings: {
    label: "Rings",
    hint: "Add smaller copies of the outline inside it.",
    range: { min: 1, max: 10 },
    step: 1,
    unit: "",
    fills: ["outline"],
    arranges: false,
    followOnly: false,
  },
  wobble: {
    label: "Wobble",
    hint: "Nudge each system a little so the shape looks less exact.",
    range: { min: 0, max: 100 },
    step: 1,
    unit: "%",
    fills: ["outline", "grid"],
    arranges: true,
    followOnly: false,
  },
  gaps: {
    label: "Gaps",
    hint: "Break the outline's lanes in this many places to make chokepoints.",
    range: { min: 0, max: 12 },
    step: 1,
    unit: "",
    fills: ["outline"],
    arranges: true,
    followOnly: true,
  },
};

export const EXTRA_KEYS = Object.keys(EXTRA_ROWS) as ExtraKey[];

/** Every choice of what sits at a shape's centre. */
export const SHAPE_CENTRES: readonly ShapeCentre[] = ["none", "system", "spokes"];

/** The extras that change nothing: one systems thick, one ring, no gaps, no wobble, nothing at the centre. */
export const NO_EXTRAS: ShapeExtras = { band: 1, rings: 1, gaps: 0, wobble: 0, centre: "none" };

/** What says whether an extra applies: the shape, its fill and its lanes. */
type Laid = Pick<ShapeSettings, "shape" | "fill" | "lanes">;

/** Whether extra `key` changes `settings` laid for `purpose`: the kind and the fill both take it, and Follow the shape is on where it needs it. */
export function extraApplies(
  key: ExtraKey,
  settings: Laid,
  purpose: ShapePurpose["kind"],
): boolean {
  const row = EXTRA_ROWS[key];
  return (
    specOf(settings.shape).extras.includes(key) &&
    row.fills.includes(settings.fill.kind) &&
    (purpose === "add" || row.arranges) &&
    (!row.followOnly || settings.lanes.follow)
  );
}

/** Whether `settings` takes a system at the centre: an outline of a kind with a centre, adding systems, as an arrange has none to spare. */
export function takesCentre(settings: Laid, purpose: ShapePurpose["kind"]): boolean {
  return (
    specOf(settings.shape).spokes !== null && settings.fill.kind === "outline" && purpose === "add"
  );
}

/** The most Wobble an arrange lays, so a step five times the least gap keeps neighbours clear of it. */
export const ARRANGE_MOST_WOBBLE = 80;

/** The Wobble `settings` arranges with: none where it doesn't apply, and at most `ARRANGE_MOST_WOBBLE`. */
export function arrangeWobble(settings: Laid & Pick<ShapeSettings, "extras">): number {
  if (!extraApplies("wobble", settings, "arrange")) return NO_EXTRAS.wobble;
  return Math.min(settings.extras.wobble, ARRANGE_MOST_WOBBLE);
}

/** The extras `pending` is laid with: each that doesn't apply as `NO_EXTRAS` has it. */
export function appliedExtras(pending: PendingShape): ShapeExtras {
  const purpose = pending.purpose.kind;
  const out = { ...pending.extras };
  for (const key of EXTRA_KEYS) {
    if (!extraApplies(key, pending, purpose)) out[key] = NO_EXTRAS[key];
  }
  if (purpose === "arrange") out.wobble = arrangeWobble(pending);
  if (!takesCentre(pending, purpose)) out.centre = NO_EXTRAS.centre;
  return out;
}

/** Keeps each extra's draws apart from the scattered fill's and the stars', which read the same seed. */
const BAND_STREAM = 0x4241_4e44;
const WOBBLE_STREAM = 0x574f_4242;

/** How far a band's point strays from its place, along and across, as a share of the step. */
export const BAND_SCATTER = 0.3;

/** How many points the outline is read at to find how close its sides come to its centre. */
const INSET_SAMPLES = 256;

/**
 * Where a run lies along the shape: the run it was laid along, which a band's strands share,
 * that run's count of points, and how far along it the run's first point sits, in steps.
 */
export interface RunPlace {
  along: number;
  count: number;
  shift: number;
}

/** Each run of `outline` laid along itself, from its start. */
export function ownPlaces(outline: Outline): RunPlace[] {
  return outline.runs.map((run, along) => ({ along, count: run.count, shift: 0 }));
}

/** The least distance from `c` to the line of a side of the polyline through `points`, round to the first when `closed`. */
function sideReach(points: readonly Pt[], closed: boolean, c: Pt): number {
  let least = Infinity;
  const sides = closed ? points.length : points.length - 1;
  for (let i = 0; i < sides; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = distance(a, b);
    if (length === 0) continue;
    const cross = (b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x);
    least = Math.min(least, Math.abs(cross) / length);
  }
  return least;
}

/**
 * How near `shape`'s sides come to its centre: the least distance from the centre to the line
 * of a side of a fine outline. A copy scaled about the centre to a share `f` of the size is
 * `(1 - f)` of this from the outline at its nearest, at a rectangle's short side, a star's
 * notch or a squashed circle's flat side alike.
 */
function insetReach(shape: Shape): number {
  const { points, runs } = specOf(shape).outline(shape, INSET_SAMPLES);
  const c = centreOf(shape);
  return Math.min(...runs.map((run) => sideReach(runPoints(points, run), run.closed, c)));
}

/**
 * `outline`, the shape's own of `count` points, with up to `rings - 1` copies scaled down inside
 * it, each at least `pitch` from the last at its nearest and with as many points as keep about
 * the same step. A copy too small for its fewest points, and every one inside it, is left out.
 */
function withRings(shape: Shape, count: number, outline: Outline, rings: number, pitch: number) {
  const spec = specOf(shape);
  const size = spec.size(shape);
  const reach = insetReach(shape);
  const closed = outline.runs.every((run) => run.closed);
  const fewest = closed ? 3 : 2;
  const parts = [outline];
  for (let k = 1; k < rings; k++) {
    const share = 1 - (k * pitch) / reach;
    const n = Math.round(count * share);
    if (!(share > 0) || n < fewest) break;
    parts.push(spec.outline(spec.resized(shape, size * share), n));
  }
  return joined(parts);
}

/** The unit vector across `points` at point `i`, square to the line through its neighbours. */
function across(points: readonly Pt[], i: number, closed: boolean): Pt {
  const last = points.length - 1;
  const before = i > 0 ? points[i - 1] : closed ? points[last] : points[i];
  const after = i < last ? points[i + 1] : closed ? points[0] : points[i];
  const length = distance(before, after);
  if (length === 0) return { x: 0, y: 0 };
  return { x: -(after.y - before.y) / length, y: (after.x - before.x) / length };
}

/** `p` moved by up to `reach` along each axis, drawn from `rand`. */
function strayed(p: Pt, reach: number, rand: Rand): Pt {
  return { x: p.x + (2 * rand() - 1) * reach, y: p.y + (2 * rand() - 1) * reach };
}

/**
 * Each run of `outline` as up to `band` runs side by side across it, a `step` apart and centred
 * on it, every other one half a step along, as bricks are laid; an open run's shifted strand
 * stops half a step short of its end. A strand that would reach as far in as `centre` from the
 * run's sides is left out, so a band never folds through the centre. Each point strays at
 * random up to `BAND_SCATTER` of a step, drawn from `seed` point by point in order, so the band
 * looks grown rather than drawn.
 */
function banded(
  outline: Outline,
  band: number,
  step: number,
  seed: number,
  centre: Pt,
): { outline: Outline; places: RunPlace[] } {
  const rand = seeded(seed ^ BAND_STREAM);
  const parts: Outline[] = [];
  const places: RunPlace[] = [];
  for (const [along, run] of outline.runs.entries()) {
    const points = runPoints(outline.points, run);
    const normals = points.map((_, i) => across(points, i, run.closed));
    const reach = sideReach(points, run.closed, centre);
    // Which way across the run the centre lies, +1 along the normals or -1 against them.
    const facing = Math.sign(
      points.reduce((t, p, i) => {
        const n = normals[i];
        return t + n.x * (centre.x - p.x) + n.y * (centre.y - p.y);
      }, 0),
    );
    for (let j = 0; j < band; j++) {
      const offset = (j - (band - 1) / 2) * step;
      const inward = offset * facing;
      if (inward > 0 && inward >= reach) continue;
      const shifted = j % 2 === 1;
      const laid = shifted && !run.closed ? points.slice(0, -1) : points;
      const strand = laid.map((p, i) => {
        const at = shifted ? lerp(p, points[(i + 1) % points.length], 0.5) : p;
        const n = normals[i];
        return strayed(
          { x: at.x + n.x * offset, y: at.y + n.y * offset },
          BAND_SCATTER * step,
          rand,
        );
      });
      parts.push(oneRun(strand, run.closed));
      places.push({ along, count: run.count, shift: shifted ? 0.5 : 0 });
    }
  }
  return { outline: joined(parts), places };
}

/** `p` nudged up to `reach` in a direction drawn from `rand`, evenly over the disc. */
function nudged(p: Pt, reach: number, rand: Rand): Pt {
  const angle = 2 * Math.PI * rand();
  const r = reach * Math.sqrt(rand());
  return { x: p.x + r * Math.cos(angle), y: p.y + r * Math.sin(angle) };
}

/** `outline` with each point nudged up to `reach`, drawn from `seed` point by point in order. */
export function wobbled(outline: Outline, reach: number, seed: number): Outline {
  const rand = seeded(seed ^ WOBBLE_STREAM);
  return { ...outline, points: outline.points.map((p) => nudged(p, reach, rand)) };
}

/** Each of a fill's `points`, laid `spacing` apart in `frame`, nudged up to `reach` by its own draws, as `pointDraws` gives them. */
export function* wobbledFill(
  points: Iterable<Pt>,
  reach: number,
  seed: number,
  frame: ShapeFrame,
  spacing: number,
): Generator<Pt> {
  for (const p of points)
    yield nudged(p, reach, pointDraws(seed, WOBBLE_STREAM, frame, spacing, p));
}

/**
 * The steps of a run of `count` points that `gaps` openings take out, spread evenly along it, a
 * step `s` running from its point `s` to the next: round a closed run, its last step back to
 * its first point, and clear of both ends of an open one. Every step with as many gaps as steps.
 */
export function gapSteps(count: number, closed: boolean, gaps: number): Set<number> {
  const steps = closed ? count : count - 1;
  const out = new Set<number>();
  const g = Math.min(gaps, steps);
  for (let k = 0; k < g; k++) {
    out.add(closed ? Math.floor((k * steps) / g) : Math.floor(((k + 1) * steps) / (g + 1)));
  }
  return out;
}

/** Where each opening of `gaps` along a run of `count` cuts it, in steps from its first point. */
function gapCuts(count: number, closed: boolean, gaps: number): number[] {
  // Three quarters along the step it opens, inside it for a band's shifted strands too.
  return [...gapSteps(count, closed, gaps)].map((s) => s + 0.75);
}

/**
 * Whether a lane from place `from` to place `to` along a run of `count` points, in steps from
 * its first, passes one of its `gaps`: going on from `from` past the end of a closed run, or
 * the shorter way round when `way` is "shorter".
 */
export function crossesGapAt(
  { count, closed }: { count: number; closed: boolean },
  gaps: number,
  from: number,
  to: number,
  way: "onward" | "shorter",
): boolean {
  const cuts = gapCuts(count, closed, gaps);
  if (!closed) return cuts.some((c) => c > Math.min(from, to) && c < Math.max(from, to));
  const round = (v: number) => ((v % count) + count) % count;
  let start = from;
  let length = round(to - from);
  if (way === "shorter" && length > count / 2) {
    start = to;
    length = count - length;
  }
  return cuts.some((c) => round(c - start) < length);
}

/** The system at the centre: its index in the row, and the row points spokes join it to, none without spokes. */
export interface Hub {
  index: number;
  spokes: readonly number[];
}

/** The mean distance from `centre` to the points of each run. */
function meanReach(outline: Outline, centre: Pt): number[] {
  return outline.runs.map((run) => {
    const points = runPoints(outline.points, run);
    return points.reduce((sum, p) => sum + distance(p, centre), 0) / Math.max(1, points.length);
  });
}

/** The points of `outline` spokes from `centre` join: every point of the run nearest it, or each run's first. */
function spokeEnds(outline: Outline, ends: SpokeEnds, centre: Pt): number[] {
  switch (ends) {
    case "arms":
      return outline.runs.map((run) => run.start);
    case "ring": {
      const reach = meanReach(outline, centre);
      const nearest = outline.runs[reach.indexOf(Math.min(...reach))];
      if (!nearest) return [];
      return Array.from({ length: nearest.count }, (_, i) => nearest.start + i);
    }
  }
}

/** An outline as a shape lays it with its extras, the system at its centre, and its step. */
export interface OutlineRow {
  outline: Outline;
  /** Where each run lies along the shape, in the runs' order. */
  places: RunPlace[];
  hub: Hub | null;
  /** How far apart neighbouring points of the shape's own outline sit, before the band and wobble. */
  step: number;
}

/**
 * `count` points along `shape`'s outline laid with `extras`: its rings inside it, each run made
 * a band, every point wobbled, then the system at its centre as a run of its own. Band and wobble
 * draw from `seed`, so a preview and the placed systems agree.
 */
export function outlineRow(
  shape: Shape,
  count: number,
  extras: ShapeExtras,
  seed: number,
): OutlineRow {
  const spec = specOf(shape);
  const first = spec.outline(shape, count);
  const step = outlineStep(first);
  // A band's strands are a step apart, so rings make room for the whole band.
  const pitch = extras.band * step;
  let outline = extras.rings > 1 ? withRings(shape, count, first, extras.rings, pitch) : first;
  let places = ownPlaces(outline);
  const centre = centreOf(shape);
  if (extras.band > 1) ({ outline, places } = banded(outline, extras.band, step, seed, centre));
  if (extras.wobble > 0) outline = wobbled(outline, (step * extras.wobble) / 200, seed);
  if (extras.centre === "none" || spec.spokes === null) return { outline, places, hub: null, step };
  const spokes = extras.centre === "spokes" ? spokeEnds(outline, spec.spokes, centre) : [];
  const hub = { index: outline.points.length, spokes };
  const hubPlace = { along: outline.runs.length, count: 1, shift: 0 };
  return {
    outline: joined([outline, oneRun([centre], false)]),
    places: [...places, hubPlace],
    hub,
    step,
  };
}
