import type { SystemNode } from "../../generated/SystemNode";
import type { MeshPoint } from "../geometry/mesh";
import { boxOf } from "../geometry/polygon";
import { PairSet, type Pair } from "../geometry/pairs";
import { dist2, type Pt, WRITTEN_DRIFT, writtenPt } from "../geometry/pt";
import { SEGMENT_CELL, type Segment } from "../geometry/segments";
import { copies, COUNTERPART_REACH, images, type Symmetry } from "../geometry/symmetry";
import { insideExtent } from "../guides";
import type { ImageOfNew } from "../placement/ground";
import { PlacementGround } from "../placement/ground";
import { LEAST_SPACING, MOST_SPACING, ON_TOP } from "../placement/limits";
import { placedLanes, provisionalId, provisionalIndex } from "../placement/lanes";
import { PointGrid } from "../placement/pointGrid";
import { symmetricCopies, type SymmetricCopies } from "../placement/symmetricCopies";
import { lattice, scatterDensity, scatterPattern } from "./fills";
import { angleOf, lerp, type ShapeFrame } from "./frame";
import { polylineLength } from "./outline";
import type { PlacementRules } from "../placement/rules";
import { centreOf, specOf } from "./specs";
import { rollStars } from "./stars";
import type {
  Fill,
  LeftOut,
  PendingShape,
  Shape,
  ShapeGround,
  ShapePreview,
  SpacedFill,
} from "./types";

/** A fill's edge row is spaced along an edge of this many points' length. */
const PERIMETER_POINTS = 360;

/** How much denser than measured a scattered fill is taken to be, so its least spacing stays clear of the cap. */
const SCATTER_MARGIN = 1.1;

/** A hex lattice's rows are this many spacings apart. */
const HEX_ROW = Math.sqrt(3) / 2;

/** How many points along each side of the box the area a shape and its images cover is sampled at. */
const UNION_SAMPLES = 64;

/** Whether `fill` lays a row of systems along the shape's edge, which follow lanes join. */
export function hasEdgeRow(fill: Fill): boolean {
  switch (fill.kind) {
    case "outline":
      return true;
    case "scattered":
      return fill.edge;
    case "grid":
      return false;
  }
}

/** The length of what a fill fills' edge, as its row is spaced along it. */
function edgeLength(shape: Shape): number {
  const { points, closed } = specOf(shape).edge(shape, PERIMETER_POINTS);
  return polylineLength(points, closed);
}

/** How many points `fill` lays per square of its spacing. */
function pointsPerSquare(fill: SpacedFill): number {
  switch (fill.kind) {
    case "scattered":
      return scatterDensity() * SCATTER_MARGIN;
    case "grid":
      return fill.lattice === "hex" ? 1 / HEX_ROW : 1;
  }
}

/**
 * The area `shape` and its images under `sym` cover together. Without symmetry it is the
 * shape's own. With it, the shape is drawn once onto a grid of `UNION_SAMPLES` cells a side over
 * their box, and a cell counts when an image of its centre lands in a cell of the shape: as the
 * images form a group, that is when the centre is inside one of the shape's images.
 */
function coveredArea(shape: Shape, sym: Symmetry): number {
  const spec = specOf(shape);
  if (copies(sym) === 1) return spec.area(shape);
  const own = spec.bounds(shape);
  const corners = [
    { x: own.x0, y: own.y0 },
    { x: own.x1, y: own.y0 },
    { x: own.x0, y: own.y1 },
    { x: own.x1, y: own.y1 },
  ];
  const box = boxOf(corners.flatMap((p) => images(p, sym)));
  const n = UNION_SAMPLES;
  const w = (box.x1 - box.x0) / n;
  const h = (box.y1 - box.y0) / n;
  if (!(w > 0 && h > 0)) return 0;
  const column = (x: number) => Math.floor((x - box.x0) / w);
  const row = (y: number) => Math.floor((y - box.y0) / h);
  const centre = (i: number, j: number) => ({
    x: box.x0 + (i + 0.5) * w,
    y: box.y0 + (j + 0.5) * h,
  });
  const inShape = new Uint8Array(n * n);
  for (let i = Math.max(0, column(own.x0)); i <= Math.min(n - 1, column(own.x1)); i++) {
    for (let j = Math.max(0, row(own.y0)); j <= Math.min(n - 1, row(own.y1)); j++) {
      if (spec.contains(shape, centre(i, j))) inShape[i * n + j] = 1;
    }
  }
  const landsInShape = (p: Pt) => {
    const i = column(p.x);
    const j = row(p.y);
    return i >= 0 && i < n && j >= 0 && j < n && inShape[i * n + j] === 1;
  };
  let inside = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (images(centre(i, j), sym).some(landsInShape)) inside++;
    }
  }
  return inside * w * h;
}

/**
 * The least spacing at which `fill` fills the whole of `shape` and its images under `sym`
 * without passing the rules' cap; never under `LEAST_SPACING` or their least gap. It counts the points the area they
 * cover together takes, and one per spacing of their edge: the edge row, or for a grid the
 * lattice points a boundary can add over its area's share. Their edge is the shape's over each
 * copy, shrunk by the share of the copies' area that overlaps. Points past the map's edge or
 * left out beside a system only lower the count.
 */
export function leastSpacing(
  shape: Shape,
  fill: SpacedFill,
  sym: Symmetry,
  rules: PlacementRules,
): number {
  const own = specOf(shape).area(shape);
  const covered = coveredArea(shape, sym);
  const c = copies(sym);
  const apart = own > 0 ? Math.min(1, covered / (own * c)) : 1;
  const area = covered * pointsPerSquare(fill);
  const edge = hasEdgeRow(fill) || fill.kind === "grid" ? edgeLength(shape) * c * apart : 0;
  const { cap } = rules;
  // area / d² + edge / d = cap, solved for 1 / d.
  const perUnit =
    area > 0 ? (Math.sqrt(edge * edge + 4 * area * cap) - edge) / (2 * area) : cap / edge;
  return Math.max(LEAST_SPACING, rules.minGap, 1 / perUnit);
}

/** The spacing `fill` is laid at: its own, loosened to `leastSpacing` when the shape is too large for it. */
export function fillSpacing(
  shape: Shape,
  fill: SpacedFill,
  sym: Symmetry,
  rules: PlacementRules,
): number {
  return Math.max(fill.spacing, leastSpacing(shape, fill, sym, rules));
}

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
 * A fill's edge row, its points no closer than `spacing`. Under symmetry, a closed row that
 * its images would interleave takes the next count down that they land on, where there is one.
 */
function fillRow(shape: Shape, spacing: number, sym: Symmetry): { row: Pt[]; closed: boolean } {
  const spec = specOf(shape);
  const closed = spec.edge(shape, PERIMETER_POINTS).closed;
  const least = closed ? 3 : 2;
  const n = Math.max(least, Math.floor(edgeLength(shape) / spacing) + (closed ? 0 : 1));
  const row = spec.edge(shape, n).points;
  const c = copies(sym);
  if (c === 1 || !closed || mapsOntoItself(row, sym)) return { row, closed };
  const even = c * Math.floor(n / c);
  if (even === n || even < least) return { row, closed };
  const evenRow = spec.edge(shape, even).points;
  return { row: mapsOntoItself(evenRow, sym) ? evenRow : row, closed };
}

function* inside(points: Iterable<Pt>, contains: (p: Pt) => boolean): Generator<Pt> {
  for (const p of points) if (contains(p)) yield p;
}

/** `p`'s images under `sym`, each as the file keeps it. */
function writtenImages(p: Pt, sym: Symmetry): Pt[] {
  return images(p, sym).map(writtenPt);
}

function layout(pending: PendingShape, sym: Symmetry, rules: PlacementRules): Layout {
  const { shape, fill, seed } = pending;
  const spec = specOf(shape);
  if (fill.kind === "outline") {
    const { points, closed } = spec.outline(shape, fill.count);
    const gaps = closed ? points.length : points.length - 1;
    const step = gaps > 0 ? polylineLength(points, closed) / gaps : 0;
    const spacing = Math.min(step, MOST_SPACING);
    return {
      row: points,
      closed,
      rowGivesWay: false,
      fill: [],
      spacing,
      skip: Math.min(spacing / 2, ON_TOP),
    };
  }
  // Laid a little past the gap, so rounding to the file's decimals can't bring two points under it.
  const spacing = Math.max(fillSpacing(shape, fill, sym, rules), rules.minGap + WRITTEN_DRIFT);
  const filled = spec.fills(shape).includes(fill.kind);
  const { row, closed } =
    hasEdgeRow(fill) || !filled ? fillRow(shape, spacing, sym) : { row: [], closed: true };
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
 * Keeps a growing set of points and all their images spaced, and the ones placed `gap` from
 * each other. An image within `COUNTERPART_REACH` of one already kept merges into it, as an
 * image on the pivot does. Images are taken as the file keeps them, and the gap is held
 * strictly on those, as the core holds it.
 */
class SpacedImages {
  /** The points taken, as placed. */
  private readonly own: PointGrid;
  /** Their images in the symmetry's other copies. */
  private readonly others: PointGrid;
  /** The points and images taken that place a system, which the gap is kept from. */
  private readonly placed: PointGrid;
  private readonly least: number;
  private readonly gap: number;

  constructor(
    private readonly sym: Symmetry,
    spacing: number,
    gap: number,
    private readonly places: (q: Pt) => boolean,
  ) {
    const cell = Math.max(spacing, COUNTERPART_REACH);
    this.own = new PointGrid(cell);
    this.others = new PointGrid(cell);
    this.placed = new PointGrid(Math.max(gap, COUNTERPART_REACH));
    // Lattice images land a spacing apart give or take rounding to the file's decimals.
    this.least = spacing - WRITTEN_DRIFT;
    this.gap = gap;
  }

  /**
   * Whether `p` and its images each merge into a point taken or keep their distance from every
   * one, whether one that places a system comes within the gap of another that does, and how
   * many new points they would place. A row point is only held its spacing from images, since
   * the row keeps its own spacing, but the gap from its own row too; a fill point that is
   * itself an image already taken adds nothing, so it does not fit.
   */
  check(p: Pt, row: boolean): { fits: boolean; tooClose: boolean; adds: number } {
    const reach2 = COUNTERPART_REACH * COUNTERPART_REACH;
    const least2 = this.least * this.least;
    const imgs = writtenImages(p, this.sym);
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
      if (!merges && this.places(q)) adds++;
    }
    return { fits, tooClose: adds > 0 && this.withinGap(imgs), adds };
  }

  /** Whether an image that places a system comes within the gap of a placed point or another such image, short of merging. */
  private withinGap(imgs: readonly Pt[]): boolean {
    if (!(this.gap > 0)) return false;
    const close = (a: Pt, b: Pt) => {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      return d >= COUNTERPART_REACH && d < this.gap;
    };
    const placing = imgs.filter(this.places);
    const g = this.gap;
    return placing.some(
      (q, k) =>
        placing.slice(0, k).some((o) => close(o, q)) ||
        this.placed.someInBox(q.x - g, q.y - g, q.x + g, q.y + g, (t) => close(t, q)),
    );
  }

  take(p: Pt): void {
    writtenImages(p, this.sym).forEach((q, k) => {
      (k === 0 ? this.own : this.others).add(q);
      if (this.gap > 0 && this.places(q)) this.placed.add(q);
    });
  }
}

/** Where a point can go: inside the extent, and placed rather than left out for a system. */
interface Where {
  inside(p: Pt): boolean;
  places(p: Pt): boolean;
}

/** The points a shape places before the galaxy has a say, and what kept it from placing more. */
interface Base {
  /** The points, as the file keeps them. */
  base: Pt[];
  /** Each base point's place in the layout: its index in the row, or the row's length plus its place among the fill's points. */
  ordinals: number[];
  rowCount: number;
  rowCut: boolean;
  /** New systems a row point would have placed, dropped for standing within the gap of another. */
  crowded: number;
  capped: boolean;
}

/**
 * The points a shape places before the galaxy has a say: the row, then the fill, until they
 * and their images would place more than the rules' cap. Under symmetry that is the cap over
 * the copies, less what merges. A point past the edge or left out for a system doesn't count,
 * and a fill point with no image inside the extent is dropped. A row point within the rules'
 * gap of another new point is dropped and counted, even an outline's. Each point is taken as
 * the file keeps it.
 */
function basePoints(
  { row, rowGivesWay, fill, spacing }: Layout,
  sym: Symmetry,
  rules: PlacementRules,
  where: Where,
): Base {
  const spaced = new SpacedImages(sym, spacing, rules.minGap, where.places);
  const base: Pt[] = [];
  const ordinals: number[] = [];
  const keep = (p: Pt, ordinal: number) => {
    base.push(p);
    ordinals.push(ordinal);
    spaced.take(p);
  };
  let total = 0;
  let crowded = 0;
  for (const [i, laid] of row.entries()) {
    const p = writtenPt(laid);
    const { fits, tooClose, adds } = spaced.check(p, true);
    if (tooClose) {
      crowded += adds;
      continue;
    }
    if (rowGivesWay && !fits) continue;
    if (total + adds > rules.cap) {
      return { base, ordinals, rowCount: base.length, rowCut: true, crowded, capped: true };
    }
    keep(p, i);
    total += adds;
  }
  const rowCount = base.length;
  let next = row.length;
  for (const laid of fill) {
    const ordinal = next++;
    const p = writtenPt(laid);
    if (!writtenImages(p, sym).some(where.inside)) continue;
    const { fits, tooClose, adds } = spaced.check(p, false);
    if (!fits || tooClose) continue;
    if (total + adds > rules.cap) {
      return { base, ordinals, rowCount, rowCut: false, crowded, capped: true };
    }
    keep(p, ordinal);
    total += adds;
  }
  return { base, ordinals, rowCount, rowCut: false, crowded, capped: false };
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
  // Lattice neighbours at the least spacing sit that far apart give or take rounding.
  const d = LEAST_SPACING - WRITTEN_DRIFT;
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
 * A star class for each kept point, `from[i]` being where point `i` stood in `all`. Each is
 * drawn for its base point's place in the layout and its copy, so a point keeps its class when
 * others are left out or come back. Empty when no class has a weight.
 */
function classesOf(
  seed: number,
  weights: ReadonlyArray<readonly [string, number]>,
  all: SymmetricCopies,
  ordinals: readonly number[],
  from: readonly number[],
  sym: Symmetry,
): string[] {
  const n = copies(sym);
  const draws = from.map((j) => {
    const [i, k] = all.made[j];
    return ordinals[i] * n + k;
  });
  const rolled = rollStars(Math.max(-1, ...draws) + 1, seed, weights);
  return rolled.length === 0 ? [] : draws.map((d) => rolled[d]);
}

/**
 * The systems and lanes `pending` would add to `ground`, and the points it leaves out. Pure, so
 * the same pending shape and ground give the same placement in the preview and in the edit.
 * Every point is as the file keeps it, so the edit sends the points the preview checked.
 */
export function shapePlacement(pending: PendingShape, ground: ShapeGround): ShapePreview {
  const { placement, extent, laneDensity, rules } = ground;
  const sym = placement.symmetry;
  const shown = layout(pending, sym, rules);
  const reach = Math.max(pending.skipNear ? shown.skip : 0, rules.minGap);
  const blockerOf = (p: Pt) => {
    const near = reach > 0 ? placement.grid.nearestSystem(p.x, p.y, reach) : null;
    return near && Math.hypot(near.x - p.x, near.y - p.y) < reach ? near : null;
  };
  const inside = (p: Pt) => insideExtent(extent, p);
  const { base, ordinals, rowCount, rowCut, crowded, capped } = basePoints(shown, sym, rules, {
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
  for (const [j, image] of all.points.entries()) {
    const p = writtenPt(image);
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
  const onRow = (id: number) => id < 0 && all.made[from[provisionalIndex(id)]][0] < rowCount;
  const mesh = placedLanes({
    points,
    base: baseKept,
    mode: pending.lanes.mode,
    density: laneDensity,
    spacing: shown.spacing,
    ground: fixed.length > 0 ? new FollowGround(placement, fixed) : placement,
    imageOfNew,
    keep: pending.lanes.follow ? (a, b) => !(onRow(a) && onRow(b)) : undefined,
  });
  for (const [a, b] of mesh) pairs.add(a, b);

  return {
    points,
    pairs: pairs.sorted(),
    left,
    outside,
    overlaps: overlapCount(points, placement),
    crowded,
    capped,
    interleaved: interleaving(pending, sym, all.points.length),
    classes:
      ground.starWeights && classesOf(pending.seed, ground.starWeights, all, ordinals, from, sym),
  };
}
