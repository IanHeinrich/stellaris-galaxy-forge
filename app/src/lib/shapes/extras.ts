import type { Pt } from "../geometry/pt";
import { seeded, type Rand } from "../random";
import { tileSeed } from "./fills";
import { distance, lerp, toLocal, type ShapeFrame } from "./frame";
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
    range: { min: 1, max: 5 },
    step: 1,
    unit: "",
    fills: ["outline"],
    arranges: false,
    followOnly: false,
  },
  rings: {
    label: "Rings",
    range: { min: 1, max: 10 },
    step: 1,
    unit: "",
    fills: ["outline"],
    arranges: false,
    followOnly: false,
  },
  wobble: {
    label: "Wobble",
    range: { min: 0, max: 100 },
    step: 1,
    unit: "%",
    fills: ["outline", "grid"],
    arranges: true,
    followOnly: false,
  },
  gaps: {
    label: "Gaps",
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

/** The extras `pending` is laid with: each that doesn't apply as `NO_EXTRAS` has it. */
export function appliedExtras(pending: PendingShape): ShapeExtras {
  const purpose = pending.purpose.kind;
  const out = { ...pending.extras };
  for (const key of EXTRA_KEYS) {
    if (!extraApplies(key, pending, purpose)) out[key] = NO_EXTRAS[key];
  }
  if (!takesCentre(pending, purpose)) out.centre = NO_EXTRAS.centre;
  return out;
}

/** Keeps each extra's draws apart from the scattered fill's and the stars', which read the same seed. */
const BAND_STREAM = 0x4241_4e44;
const WOBBLE_STREAM = 0x574f_4242;

/** How far a band's point strays from its place, along and across, as a share of the step. */
export const BAND_SCATTER = 0.3;

/** How finely a fill point's place is told apart for its wobble, in parts of the spacing. */
const WOBBLE_GRAIN = 1000;

/** How many points the outline is read at to find how close its sides come to its centre. */
const INSET_SAMPLES = 256;

/** Where a run lies along the shape: the run it was laid along, which a band's strands share, and how far along it its first point sits, in steps. */
export interface RunPlace {
  along: number;
  shift: number;
}

/** Each run of `outline` laid along itself, from its start. */
function ownPlaces(outline: Outline): RunPlace[] {
  return outline.runs.map((_, along) => ({ along, shift: 0 }));
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
  let least = Infinity;
  for (const run of runs) {
    const along = runPoints(points, run);
    const sides = run.closed ? along.length : along.length - 1;
    for (let i = 0; i < sides; i++) {
      const a = along[i];
      const b = along[(i + 1) % along.length];
      const length = distance(a, b);
      if (length === 0) continue;
      const cross = (b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x);
      least = Math.min(least, Math.abs(cross) / length);
    }
  }
  return least;
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
 * Each run of `outline` as `band` runs side by side across it, a `step` apart and centred on
 * it, every other one half a step along, as bricks are laid. Each point strays at random up to
 * `BAND_SCATTER` of a step, drawn from `seed` point by point in order, so the band looks grown
 * rather than drawn.
 */
function banded(
  outline: Outline,
  band: number,
  step: number,
  seed: number,
): { outline: Outline; places: RunPlace[] } {
  const rand = seeded(seed ^ BAND_STREAM);
  const parts: Outline[] = [];
  const places: RunPlace[] = [];
  for (const [along, run] of outline.runs.entries()) {
    const points = runPoints(outline.points, run);
    const normals = points.map((_, i) => across(points, i, run.closed));
    for (let j = 0; j < band; j++) {
      const offset = (j - (band - 1) / 2) * step;
      const strand = points.map((p, i) => {
        const next = i + 1 < points.length ? points[i + 1] : run.closed ? points[0] : null;
        const at = j % 2 === 1 && next ? lerp(p, next, 0.5) : p;
        const n = normals[i];
        return strayed(
          { x: at.x + n.x * offset, y: at.y + n.y * offset },
          BAND_SCATTER * step,
          rand,
        );
      });
      parts.push(oneRun(strand, run.closed));
      places.push({ along, shift: j % 2 === 1 ? 0.5 : 0 });
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

/**
 * Each of a fill's `points`, laid `spacing` apart in `frame`, nudged up to `reach`. Each nudge
 * is drawn from `seed` and where the point stands in the frame, so a point keeps its nudge as
 * the fill grows and as the shape moves.
 */
export function* wobbledFill(
  points: Iterable<Pt>,
  reach: number,
  seed: number,
  frame: ShapeFrame,
  spacing: number,
): Generator<Pt> {
  for (const p of points) {
    const local = toLocal(frame, p);
    const i = Math.round((local.x * WOBBLE_GRAIN) / spacing);
    const j = Math.round((local.y * WOBBLE_GRAIN) / spacing);
    yield nudged(p, reach, seeded(tileSeed(seed ^ WOBBLE_STREAM, i, j)));
  }
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
 * Whether a lane from place `x` to place `y` along a run of `count` points, in steps from its
 * first, passes one of its `gaps`: the shorter way round a closed run.
 */
export function crossesGapAt(
  count: number,
  closed: boolean,
  gaps: number,
  x: number,
  y: number,
): boolean {
  const cuts = gapCuts(count, closed, gaps);
  if (!closed) return cuts.some((c) => c > Math.min(x, y) && c < Math.max(x, y));
  const round = (v: number) => ((v % count) + count) % count;
  let from = x;
  let length = round(y - x);
  if (length > count / 2) {
    from = y;
    length = count - length;
  }
  return cuts.some((c) => round(c - from) < length);
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
  if (extras.band > 1) ({ outline, places } = banded(outline, extras.band, step, seed));
  if (extras.wobble > 0) outline = wobbled(outline, (step * extras.wobble) / 200, seed);
  if (extras.centre === "none" || spec.spokes === null) return { outline, places, hub: null, step };
  const centre = centreOf(shape);
  const spokes = extras.centre === "spokes" ? spokeEnds(outline, spec.spokes, centre) : [];
  const hub = { index: outline.points.length, spokes };
  const hubPlace = { along: outline.runs.length, shift: 0 };
  return {
    outline: joined([outline, oneRun([centre], false)]),
    places: [...places, hubPlace],
    hub,
    step,
  };
}
