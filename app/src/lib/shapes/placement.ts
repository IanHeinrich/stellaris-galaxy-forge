import type { SystemNode } from "../../generated/SystemNode";
import type { MeshPoint } from "../geometry/mesh";
import { PairSet, type Pair } from "../geometry/pairs";
import { dist2, type Pt } from "../geometry/pt";
import { SEGMENT_CELL, type Segment } from "../geometry/segments";
import { copies, COUNTERPART_REACH, images, type Symmetry } from "../geometry/symmetry";
import { insideExtent } from "../guides";
import type { ImageOfNew } from "../placement/ground";
import { PlacementGround } from "../placement/ground";
import { LEAST_SPACING, MOST_SPACING, SAMPLE_CAP } from "../placement/limits";
import { placedLanes, provisionalId, provisionalIndex } from "../placement/lanes";
import { PointGrid } from "../placement/pointGrid";
import { symmetricCopies } from "../placement/symmetricCopies";
import { lattice, scatterPattern } from "./fills";
import { angleOf, lerp, type ShapeFrame } from "./frame";
import { polylineLength } from "./outline";
import { centreOf, specOf } from "./specs";
import type { LeftOut, PendingShape, Shape, ShapeGround, ShapePreview } from "./types";

/** A fill's outline row is spaced along an outline of this many points' length. */
const PERIMETER_POINTS = 360;

/** The frame a shape's fill pattern is laid in, so it moves and turns with the shape. */
function frameOf(shape: Shape): ShapeFrame {
  const rotation = shape.kind === "line" ? angleOf(shape.a, shape.b) : shape.rotation;
  return { origin: centreOf(shape), rotation };
}

/** Where a pending shape puts its points, before the galaxy has a say. */
interface Layout {
  /** The points along the outline, in the order follow lanes join them. */
  row: Pt[];
  closed: boolean;
  /** Whether the row gives way where symmetry's images crowd it, as a fill's does; an outline keeps the player's count. */
  rowGivesWay: boolean;
  /** The fill's points inside the shape, nearest the centre first and made as they are read, before they are kept clear of the row. */
  fill: Iterable<Pt>;
  /** How far apart the points are: the fill's spacing, or the outline's step up to `MOST_SPACING`. */
  spacing: number;
  /** A point with an existing system this near is left out, when the player asks. */
  skip: number;
}

/** Whether symmetry's images of `points` all land on them, as a ring on the pivot's do. */
function mapsOntoItself(points: readonly Pt[], sym: Symmetry): boolean {
  return symmetricCopies(points, sym).points.length === points.length;
}

/**
 * A fill's outline row, its points no closer than `spacing`. Under symmetry, a closed row that
 * its images would interleave takes the next count down that they land on, where there is one.
 */
function fillRow(shape: Shape, spacing: number, sym: Symmetry): { row: Pt[]; closed: boolean } {
  const spec = specOf(shape);
  const around = spec.outline(shape, PERIMETER_POINTS);
  const closed = around.closed;
  const least = closed ? 3 : 2;
  const length = polylineLength(around.points, closed);
  const n = Math.max(least, Math.floor(length / spacing) + (closed ? 0 : 1));
  const row = spec.outline(shape, n).points;
  const c = copies(sym);
  if (c === 1 || !closed || mapsOntoItself(row, sym)) return { row, closed };
  const even = c * Math.floor(n / c);
  if (even === n || even < least) return { row, closed };
  const evenRow = spec.outline(shape, even).points;
  return { row: mapsOntoItself(evenRow, sym) ? evenRow : row, closed };
}

function* inside(points: Iterable<Pt>, contains: (p: Pt) => boolean): Generator<Pt> {
  for (const p of points) if (contains(p)) yield p;
}

function layout(pending: PendingShape, sym: Symmetry): Layout {
  const { shape, fill, seed } = pending;
  const spec = specOf(shape);
  if (fill.kind === "outline") {
    const { points, closed } = spec.outline(shape, fill.count);
    const gaps = closed ? points.length : points.length - 1;
    const step = gaps > 0 ? polylineLength(points, closed) / gaps : 0;
    const spacing = Math.min(step, MOST_SPACING);
    return { row: points, closed, rowGivesWay: false, fill: [], spacing, skip: spacing / 2 };
  }
  const { spacing } = fill;
  const filled = spec.fills(shape).includes(fill.kind);
  const { row, closed } =
    fill.kind === "scattered" || !filled ? fillRow(shape, spacing, sym) : { row: [], closed: true };
  const laid = { row, closed, rowGivesWay: true, spacing, skip: spacing };
  if (!filled) return { ...laid, fill: [] };
  const frame = frameOf(shape);
  const bounds = spec.bounds(shape);
  const pattern =
    fill.kind === "grid"
      ? lattice(fill.lattice, spacing, frame, bounds)
      : scatterPattern(seed, spacing, frame, bounds);
  return { ...laid, fill: inside(pattern, (p) => spec.contains(shape, p)) };
}

/**
 * Keeps a growing set of points and all their images spaced. An image within
 * `COUNTERPART_REACH` of one already kept merges into it, as an image on the pivot does.
 */
class SpacedImages {
  /** The points taken, as placed. */
  private readonly own: PointGrid;
  /** Their images in the symmetry's other copies. */
  private readonly others: PointGrid;
  private readonly least: number;

  constructor(
    private readonly sym: Symmetry,
    spacing: number,
  ) {
    const cell = Math.max(spacing, COUNTERPART_REACH);
    this.own = new PointGrid(cell);
    this.others = new PointGrid(cell);
    // Lattice images land a spacing apart give or take float noise.
    this.least = spacing * (1 - 1e-9);
  }

  /**
   * Whether `p` and its images each merge into a point taken or keep their distance from every
   * one, and how many new points `places` would place. A row point is only held apart from
   * images, since the row keeps its own spacing; a fill point that is itself an image already
   * taken adds nothing, so it does not fit.
   */
  check(p: Pt, row: boolean, places: (q: Pt) => boolean): { fits: boolean; adds: number } {
    const reach2 = COUNTERPART_REACH * COUNTERPART_REACH;
    const least2 = this.least * this.least;
    const imgs = images(p, this.sym);
    let fits = true;
    let adds = 0;
    for (let k = 0; k < imgs.length; k++) {
      const q = imgs[k];
      let merges = false;
      for (let j = 0; j < k; j++) {
        const d = dist2(imgs[j], q);
        if (d < reach2) merges = true;
        else if (d < least2) fits = false;
      }
      let crowded = false;
      const near = (t: Pt) => {
        const d = dist2(t, q);
        if (d < reach2) merges = true;
        else if (d < least2) crowded = true;
        return false;
      };
      const s = this.least;
      this.others.someInBox(q.x - s, q.y - s, q.x + s, q.y + s, near);
      if (crowded) fits = false;
      crowded = false;
      this.own.someInBox(q.x - s, q.y - s, q.x + s, q.y + s, near);
      if (crowded && !(k === 0 && row)) fits = false;
      if (k === 0 && merges && !row) fits = false;
      if (!merges && places(q)) adds++;
    }
    return { fits, adds };
  }

  take(p: Pt): void {
    images(p, this.sym).forEach((q, k) => (k === 0 ? this.own : this.others).add(q));
  }
}

/** Where a point can go: inside the extent, and placed rather than left out for a system. */
interface Where {
  inside(p: Pt): boolean;
  places(p: Pt): boolean;
}

/**
 * The points a shape places before the galaxy has a say: the row, then the fill, until they
 * and their images would place more than `SAMPLE_CAP`. Under symmetry that is the cap over
 * the copies, less what merges. A point past the edge or left out for a system doesn't count,
 * and a fill point with no image inside the extent is dropped.
 */
function basePoints(
  { row, rowGivesWay, fill, spacing }: Layout,
  sym: Symmetry,
  where: Where,
): { base: Pt[]; rowCount: number; rowCut: boolean; capped: boolean } {
  const spaced = new SpacedImages(sym, spacing);
  const base: Pt[] = [];
  let total = 0;
  for (const p of row) {
    const { fits, adds } = spaced.check(p, true, where.places);
    if (rowGivesWay && !fits) continue;
    if (total + adds > SAMPLE_CAP) {
      return { base, rowCount: base.length, rowCut: true, capped: true };
    }
    base.push(p);
    spaced.take(p);
    total += adds;
  }
  const rowCount = base.length;
  for (const p of fill) {
    if (!images(p, sym).some(where.inside)) continue;
    const { fits, adds } = spaced.check(p, false, where.places);
    if (!fits) continue;
    if (total + adds > SAMPLE_CAP) return { base, rowCount, rowCut: false, capped: true };
    base.push(p);
    spaced.take(p);
    total += adds;
  }
  return { base, rowCount, rowCut: false, capped: false };
}

/** What becomes of one point: placed under its new index, left out for a system, or past the edge. */
type Fate =
  { kind: "kept"; index: number } | { kind: "left"; blocker: number } | { kind: "outside" };

/** A placement ground that also counts the follow lanes as lanes, so the mesh never crosses them. */
class FollowGround extends PlacementGround {
  constructor(
    private readonly inner: PlacementGround,
    private readonly follow: ReadonlyArray<Segment<MeshPoint>>,
  ) {
    super(inner.systems, inner.grid, inner.symmetry);
  }

  override lanesNear(points: readonly Pt[], d: number): Array<Segment<MeshPoint>> {
    return [...this.inner.lanesNear(points, d), ...this.follow];
  }
}

/** Whether existing systems `a` and `b` are linked already, or kept apart. */
function apart(systems: ReadonlyMap<number, SystemNode>, a: number, b: number): boolean {
  const s = systems.get(a);
  return !s || s.lanes.some((l) => l.to === b) || s.prevented.includes(b);
}

interface FollowInput {
  rowCount: number;
  closed: boolean;
  /** The id standing for row point `i`: a new point, the system it was left out for, or null. */
  standIn(i: number): number | null;
  at(id: number): Pt;
  ground: PlacementGround;
  imageOfNew: ImageOfNew;
}

/**
 * Lanes joining each row point to the next, round to the first when the row is closed, each
 * with its images under symmetry. A point left out for a system has that system stand in for
 * it. As with the paint brush, a lane goes in with all its images or not at all: dropped when
 * one would cross an existing lane or one taken before it, or join two systems already linked
 * or kept apart.
 */
function followLanes({ rowCount, closed, standIn, at, ground, imageOfNew }: FollowInput): Pair[] {
  const steps: Array<[number, number]> = [];
  for (let i = 0; i + 1 < rowCount; i++) steps.push([i, i + 1]);
  if (closed && rowCount >= 3) steps.push([rowCount - 1, 0]);
  const wanted: Pair[] = [];
  for (const [i, j] of steps) {
    const a = standIn(i);
    const b = standIn(j);
    if (a !== null && b !== null && a !== b) wanted.push([a, b]);
  }
  const samples: Pt[] = [];
  for (const [a, b] of wanted) {
    const p = at(a);
    const q = at(b);
    const n = Math.ceil(Math.sqrt(dist2(p, q)) / SEGMENT_CELL);
    for (let k = 0; k <= n; k++)
      samples.push(...images(lerp(p, q, k / Math.max(1, n)), ground.symmetry));
  }
  const existing = ground.lanesNear(samples, SEGMENT_CELL / 2 + 1);
  const linkable = (a: number, b: number) =>
    a < 0 || b < 0 || !(apart(ground.systems, a, b) || apart(ground.systems, b, a));
  return ground.symmetricLanes(wanted, imageOfNew, at, existing, linkable);
}

/** How many of `points` sit closer than `LEAST_SPACING` to another of them or to an existing system. */
function overlapCount(points: readonly Pt[], ground: PlacementGround): number {
  // Lattice neighbours at the least spacing sit that far apart give or take float noise.
  const d = LEAST_SPACING * (1 - 1e-9);
  const grid = new PointGrid(d);
  for (const p of points) grid.add(p);
  return points.filter(
    (p) =>
      ground.grid.closerThan(p.x, p.y, d) ||
      grid.someInBox(p.x - d, p.y - d, p.x + d, p.y + d, (q) => q !== p && dist2(p, q) < d * d),
  ).length;
}

/**
 * The symmetry's copies when an outline's images fall between its points, and a count they
 * divide would have merged them into it.
 */
function interleaving(pending: PendingShape, sym: Symmetry, placed: number): number | null {
  const n = copies(sym);
  const { shape, fill } = pending;
  if (n === 1 || fill.kind !== "outline" || placed <= fill.count) return null;
  const even = n * Math.ceil(fill.count / n);
  if (even === fill.count) return null;
  const outline = specOf(shape).outline(shape, even);
  return outline.closed && mapsOntoItself(outline.points, sym) ? n : null;
}

/**
 * The systems and lanes `pending` would add to `ground`, and the points it leaves out. Pure, so
 * the same pending shape and ground give the same placement in the preview and in the edit.
 */
export function shapePlacement(pending: PendingShape, ground: ShapeGround): ShapePreview {
  const { placement, extent, beta } = ground;
  const sym = placement.symmetry;
  const shown = layout(pending, sym);
  const blockerOf = (p: Pt) =>
    pending.skipNear ? placement.grid.nearestSystem(p.x, p.y, shown.skip) : null;
  const inside = (p: Pt) => insideExtent(extent, p);
  const { base, rowCount, rowCut, capped } = basePoints(shown, sym, {
    inside,
    places: (p) => inside(p) && !blockerOf(p),
  });
  const all = symmetricCopies(base, sym);

  const fates: Fate[] = [];
  const points: Pt[] = [];
  const left: LeftOut[] = [];
  const outside: Pt[] = [];
  /** Where each kept point stood in `all.points`. */
  const from: number[] = [];
  for (const [j, p] of all.points.entries()) {
    if (!inside(p)) {
      fates.push({ kind: "outside" });
      outside.push(p);
      continue;
    }
    const near = blockerOf(p);
    if (near) {
      fates.push({ kind: "left", blocker: near.id });
      left.push({ at: p, blocker: near.id });
      continue;
    }
    fates.push({ kind: "kept", index: points.length });
    points.push(p);
    from.push(j);
  }
  const baseKept = fates.slice(0, base.length).filter((f) => f.kind === "kept").length;
  const indexOf = (j: number | null): number | null => {
    const fate = j === null ? null : fates[j];
    return fate?.kind === "kept" ? fate.index : null;
  };
  const imageOfNew: ImageOfNew = (i, m) => indexOf(all.imageOfNew(from[i], m));
  const at = (id: number): Pt =>
    id < 0 ? points[provisionalIndex(id)] : placement.systems.get(id)!;

  const pairs = new PairSet();
  const follow = pending.lanes.follow
    ? followLanes({
        rowCount,
        closed: shown.closed && !rowCut,
        standIn(i) {
          const fate = fates[i];
          if (fate.kind === "kept") return provisionalId(fate.index);
          return fate.kind === "left" ? fate.blocker : null;
        },
        at,
        ground: placement,
        imageOfNew,
      })
    : [];
  for (const [a, b] of follow) pairs.add(a, b);
  const meshPoint = (id: number): MeshPoint => ({ id, x: at(id).x, y: at(id).y });
  const fixed = follow.map(([a, b]) => ({ a: meshPoint(a), b: meshPoint(b) }));
  const mesh = placedLanes({
    points,
    base: baseKept,
    mode: pending.lanes.mode,
    beta,
    spacing: shown.spacing,
    ground: fixed.length > 0 ? new FollowGround(placement, fixed) : placement,
    imageOfNew,
  });
  for (const [a, b] of mesh) pairs.add(a, b);

  return {
    points,
    pairs: pairs.sorted(),
    left,
    outside,
    overlaps: overlapCount(points, placement),
    capped,
    interleaved: interleaving(pending, sym, all.points.length),
  };
}
