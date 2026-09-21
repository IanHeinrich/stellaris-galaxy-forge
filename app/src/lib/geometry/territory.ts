import polygonClipping, { type Geom, type MultiPolygon, type Pair } from "polygon-clipping";
import polylabel from "polylabel";
import type { Pt } from "./hull";

/** Multipolygon: polygons → rings (outer only, holes dropped) → unclosed points. */
export type Region = Pt[][][];

/** What the territory maths reads of a system; a `SystemNode` is one. */
export interface TerritorySystem {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly owner: number | null;
  readonly lanes: readonly { readonly to: number }[];
}

export interface TerritoryParams {
  /** Reach of a system's disc, in world units. */
  radius: number;
  /** Half the width of the band along a lane both ends of which share an owner. */
  laneHalfWidth: number;
  /** Vertices per disc. */
  segments?: number;
}

export interface LabelAnchor {
  x: number;
  y: number;
  /** Distance from the anchor to the nearest edge of its polygon. */
  inradius: number;
  /** Square root of the polygon's area: its extent regardless of shape. */
  extent: number;
  /** Bounding-box width of the polygon, in world units. */
  width: number;
  /** Bounding-box height of the polygon, in world units. */
  height: number;
}

/** A lane both ends of which share an owner; `key` is its end ids as `min-max`. */
export interface Lane {
  key: string;
  a: TerritorySystem;
  b: TerritorySystem;
  length: number;
  owner: number;
}

/** What one system or lane contributes to its country: its snapped rings and the point they are centred on. */
export interface Piece {
  rings: Pair[][];
  x: number;
  y: number;
}

/** A country's pieces by source: a disc under its system's id, a band under its lane's key. */
export type Pieces = Map<string, Piece>;

const DEFAULT_SEGMENTS = 16;
const LABEL_PRECISION = 1;
const EPS2 = 1e-12;
const CELL_OFFSET = 1 << 15;
/** Rings smaller than this, in world units², are slivers of the union and are dropped. */
const MIN_RING_AREA = 25;
const DEFAULT_SMOOTHING = 1;
/** Spacing of the resampled outline before it is relaxed, in world units. */
const RELAX_STEP = 4;
/** Gaussian width of the relaxation along the outline, in world units. */
const RELAX_SIGMA = 10;
/** Vertices are snapped to this grid before the union so shared edges coincide exactly. */
const SNAP = 1e-3;
/** A band severed by many foreign systems stops splitting at this many pieces. */
const MAX_BAND_PIECES = 64;

/**
 * The territory of every country, after the game: a point is a country's when its nearest
 * system overall belongs to that country and it lies within `radius` of one of the country's
 * systems or within `laneHalfWidth` of a lane between two of them. Each owned system claims a
 * disc cut back to the bisectors of every system of another or no owner within reach, while
 * same-owner discs overlap freely; each same-owner lane claims a band, severed wherever such a
 * system is nearer than both ends of the lane. Pieces of one country are unioned into a
 * `Region` of hole-free polygons. With `only`, regions are computed for those countries alone;
 * every system of another owner still clips.
 */
export function countryRegions(
  systems: Iterable<TerritorySystem>,
  params: TerritoryParams,
  only?: ReadonlySet<number>,
): Map<number, Region> {
  const regions = new Map<number, Region>();
  for (const [owner, pieces] of countryPieces(systems, params, only)) {
    const region = regionOf(polygonsOf(pieces.values()), owner);
    if (region.length > 0) regions.set(owner, region);
  }
  return regions;
}

/** Every country's pieces, or with `only` those countries' alone; see `countryRegions`. */
export function countryPieces(
  systems: Iterable<TerritorySystem>,
  params: TerritoryParams,
  only?: ReadonlySet<number>,
): Map<number, Pieces> {
  const index = new SystemIndex(systems, params);
  const owned = index.owned().filter((s) => only === undefined || only.has(s.owner as number));
  const out = new Map<number, Pieces>();
  const piecesOf = (owner: number): Pieces => {
    let pieces = out.get(owner);
    if (!pieces) out.set(owner, (pieces = new Map()));
    return pieces;
  };
  for (const s of owned) piecesOf(s.owner as number).set(String(s.id), index.disc(s));
  for (const l of index.lanes(owned)) piecesOf(l.owner).set(l.key, index.band(l));
  return out;
}

/** Each ring of each piece as a polygon, ready to union. */
export function polygonsOf(pieces: Iterable<Piece>): Geom[] {
  const polygons: Geom[] = [];
  for (const piece of pieces) for (const ring of piece.rings) polygons.push([ring]);
  return polygons;
}

/** The union of `geoms` as outer rings of at least `MIN_RING_AREA`, unclosed; holes and slivers are dropped. */
export function regionOf(geoms: Geom[], owner: number): Region {
  return toRegion(unionOf(geoms, owner));
}

/** One galaxy's systems, indexed so a piece finds the systems of other owners that clip it. */
export class SystemIndex {
  private readonly byId = new Map<number, TerritorySystem>();
  private readonly grid: Buckets<TerritorySystem>;
  private readonly reach: number;

  constructor(
    systems: Iterable<TerritorySystem>,
    private readonly params: TerritoryParams,
  ) {
    this.reach = 2 * params.radius;
    this.grid = new Buckets(Math.max(this.reach, 1));
    for (const s of systems) {
      this.byId.set(s.id, s);
      this.grid.add(s.x, s.y, s.x, s.y, s);
    }
  }

  owned(): TerritorySystem[] {
    const out: TerritorySystem[] = [];
    for (const s of this.byId.values()) if (s.owner !== null) out.push(s);
    return out;
  }

  /** Each lane between two systems of one owner among `owned`, once. */
  lanes(owned: TerritorySystem[]): Lane[] {
    return sameOwnerLanes(owned, this.byId);
  }

  /** The disc of `s`, cut back to the bisectors of every system of another owner within reach. */
  disc(s: TerritorySystem): Piece {
    const reach = this.reach;
    let disc = ngon(s.x, s.y, this.params.radius, this.params.segments ?? DEFAULT_SEGMENTS);
    this.grid.forEachIn(s.x - reach, s.y - reach, s.x + reach, s.y + reach, (f) => {
      if (f.id === s.id || f.owner === s.owner) return;
      const d2 = dist2(s.x, s.y, f.x, f.y);
      if (d2 < reach * reach && d2 > EPS2) disc = keepNearer(disc, s.x, s.y, f.x, f.y);
    });
    return { rings: snapped([disc]), x: s.x, y: s.y };
  }

  /** Whether a system at (`x`, `y`) can clip the disc of `s`. */
  clipsDisc(s: TerritorySystem, x: number, y: number): boolean {
    return dist2(s.x, s.y, x, y) < this.reach * this.reach;
  }

  /** The band of `l`, severed wherever a system of another owner is nearer than both of its ends. */
  band(l: Lane): Piece {
    const x = (l.a.x + l.b.x) / 2;
    const y = (l.a.y + l.b.y) / 2;
    const band = bandOf(l, this.params.laneHalfWidth);
    if (band === null) return { rings: [], x, y };
    const foreign: TerritorySystem[] = [];
    const box = laneBox(l, this.params);
    this.grid.forEachIn(box.minX, box.minY, box.maxX, box.maxY, (f) => {
      if (f.owner !== l.owner) foreign.push(f);
    });
    return { rings: snapped(severBand(band, l, foreign)), x, y };
  }

  /** Whether a system at (`x`, `y`) is among the ones `band(l)` is severed by. */
  seversBand(l: Lane, x: number, y: number): boolean {
    const box = laneBox(l, this.params);
    return this.grid.covers(box.minX, box.minY, box.maxX, box.maxY, x, y);
  }
}

/** The box a lane's band looks for foreign systems in: its ends padded by the lane's reach. */
function laneBox(
  l: Lane,
  params: TerritoryParams,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const pad = laneReach(l.length, params);
  return {
    minX: Math.min(l.a.x, l.b.x) - pad,
    minY: Math.min(l.a.y, l.b.y) - pad,
    maxX: Math.max(l.a.x, l.b.x) + pad,
    maxY: Math.max(l.a.y, l.b.y) + pad,
  };
}

function snapped(rings: Pair[][]): Pair[][] {
  const out: Pair[][] = [];
  for (const ring of rings) {
    const snap = snapRing(ring);
    if (snap.length >= 3) out.push(snap);
  }
  return out;
}

/**
 * Chaikin corner cutting of a closed ring: each edge (p, q) becomes ¼ and ¾ of the way along,
 * doubling the point count per iteration and staying inside the ring's convex hull.
 */
export function smoothRing(ring: Pt[], iterations = DEFAULT_SMOOTHING): Pt[] {
  let out = ring;
  for (let n = 0; n < iterations && out.length >= 3; n++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      next.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      next.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    out = next;
  }
  return out;
}

/**
 * Gaussian relaxation of a closed ring: the outline is resampled every `step` units, then
 * each point is replaced by the weighted mean of its neighbours within three `sigma` of
 * outline distance. Notches between overlapping discs and the corners of lane bands wash
 * out; straight runs and gentle arcs keep their shape.
 */
export function relaxRing(ring: Pt[], step = RELAX_STEP, sigma = RELAX_SIGMA): Pt[] {
  const pts = resampleRing(ring, step);
  const n = pts.length;
  if (n < 3) return pts;
  const reach = Math.min(Math.ceil((3 * sigma) / step), Math.floor((n - 1) / 2));
  const weights: number[] = [];
  for (let k = -reach; k <= reach; k++) {
    const d = (k * step) / sigma;
    weights.push(Math.exp(-0.5 * d * d));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -reach; k <= reach; k++) {
      const p = pts[(((i + k) % n) + n) % n];
      const w = weights[k + reach];
      x += w * p.x;
      y += w * p.y;
    }
    out.push({ x: x / total, y: y / total });
  }
  return out;
}

/** Points every `step` units along the ring's outline, starting at its first vertex. */
function resampleRing(ring: Pt[], step: number): Pt[] {
  if (ring.length < 3) return ring.slice();
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    let t = carry;
    while (t < len) {
      out.push({ x: p.x + (dx * t) / len, y: p.y + (dy * t) / len });
      t += step;
    }
    carry = t - len;
  }
  return out.length >= 3 ? out : ring.slice();
}

/** Each ring relaxed, then Chaikin-rounded `iterations` times. */
export function smoothRegion(region: Region, iterations = DEFAULT_SMOOTHING): Region {
  return region.map((polygon) => polygon.map((ring) => smoothRing(relaxRing(ring), iterations)));
}

/** The pole of inaccessibility of the region's largest polygon, or null for an empty region. */
export function regionLabelAnchor(region: Region): LabelAnchor | null {
  let best: Pt[][] | null = null;
  let bestArea = -1;
  for (const polygon of region) {
    if (polygon.length === 0 || polygon[0].length < 3) continue;
    const area = Math.abs(ringArea(polygon[0]));
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  if (best === null) return null;
  const pole = polylabel(
    best.map((ring) => ring.map((p): Pair => [p.x, p.y])),
    LABEL_PRECISION,
  );
  const box = bounds(best[0]);
  return {
    x: pole[0],
    y: pole[1],
    inradius: pole.distance,
    extent: Math.sqrt(bestArea),
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
  };
}

function bounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Countries whose region can change when `changed` systems move or change owner: their
 * owners before and after, plus every owner with a system within `2 · radius` or a lane
 * within its reach of either position.
 */
export function affectedCountries(
  changed: TerritorySystem[],
  before: ReadonlyMap<number, TerritorySystem>,
  after: ReadonlyMap<number, TerritorySystem>,
  params: TerritoryParams,
): Set<number> {
  const out = new Set<number>();
  if (changed.length === 0) return out;
  const was = new Neighbourhood(before, params);
  const is = new Neighbourhood(after, params);
  for (const node of changed) {
    const old = before.get(node.id);
    if (old) was.collect(old, out);
    is.collect(after.get(node.id) ?? node, out);
  }
  return out;
}

/** One galaxy's owned systems and same-owner lanes, indexed so a point finds what reaches it. */
class Neighbourhood {
  private readonly reach: number;
  private readonly discs: Buckets<TerritorySystem>;
  private readonly bands: Buckets<Lane>;

  constructor(
    systems: ReadonlyMap<number, TerritorySystem>,
    private readonly params: TerritoryParams,
  ) {
    this.reach = 2 * params.radius;
    const cell = Math.max(this.reach, 1);
    this.discs = new Buckets(cell);
    this.bands = new Buckets(cell);
    const owned: TerritorySystem[] = [];
    for (const s of systems.values()) {
      if (s.owner === null) continue;
      owned.push(s);
      this.discs.add(s.x, s.y, s.x, s.y, s);
    }
    for (const l of sameOwnerLanes(owned, systems)) {
      const box = laneBox(l, params);
      this.bands.add(box.minX, box.minY, box.maxX, box.maxY, l);
    }
  }

  /** Adds `s`'s own owner, then every owner whose disc or lane band covers `s`. */
  collect(s: TerritorySystem, out: Set<number>): void {
    if (s.owner !== null) out.add(s.owner);
    const reach2 = this.reach * this.reach;
    this.discs.forEachIn(
      s.x - this.reach,
      s.y - this.reach,
      s.x + this.reach,
      s.y + this.reach,
      (t) => {
        if (t.id !== s.id && dist2(s.x, s.y, t.x, t.y) < reach2) out.add(t.owner as number);
      },
    );
    this.bands.forEachIn(s.x, s.y, s.x, s.y, (l) => {
      if (out.has(l.owner)) return;
      const pad = laneReach(l.length, this.params);
      const q = closestOnSegment(s.x, s.y, l.a.x, l.a.y, l.b.x, l.b.y);
      if (dist2(s.x, s.y, q[0], q[1]) < pad * pad) out.add(l.owner);
    });
  }
}

/** How far from a lane a system of another owner can be the nearest to a point of its band. */
function laneReach(length: number, params: TerritoryParams): number {
  const w = params.laneHalfWidth;
  return Math.max(params.radius + w, length / 2 + 2 * w);
}

/** Each lane between two systems of one owner, once. */
function sameOwnerLanes(
  owned: TerritorySystem[],
  byId: ReadonlyMap<number, TerritorySystem>,
): Lane[] {
  const lanes: Lane[] = [];
  for (const a of owned) {
    for (const lane of a.lanes) {
      const b = byId.get(lane.to);
      if (!b || b.owner !== a.owner) continue;
      if (a.id > b.id && b.lanes.some((l) => l.to === a.id)) continue;
      lanes.push({
        key: a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`,
        a,
        b,
        length: Math.hypot(b.x - a.x, b.y - a.y),
        owner: a.owner as number,
      });
    }
  }
  return lanes;
}

function ngon(cx: number, cy: number, radius: number, segments: number): Pair[] {
  const points: Pair[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return points;
}

/** The rectangle of half-width `halfWidth` around a lane; null for a zero-length lane. */
function bandOf(l: Lane, halfWidth: number): Pair[] | null {
  if (l.length === 0) return null;
  const nx = (-(l.b.y - l.a.y) / l.length) * halfWidth;
  const ny = ((l.b.x - l.a.x) / l.length) * halfWidth;
  return [
    [l.a.x - nx, l.a.y - ny],
    [l.b.x - nx, l.b.y - ny],
    [l.b.x + nx, l.b.y + ny],
    [l.a.x + nx, l.a.y + ny],
  ];
}

/**
 * The band without the points nearer a `foreign` system than both ends of its lane: for each
 * such system a piece splits into the part nearer end A and the part nearer end B.
 */
function severBand(band: Pair[], l: Lane, foreign: TerritorySystem[]): Pair[][] {
  let pieces = [band];
  for (const f of foreign) {
    const next: Pair[][] = [];
    for (const piece of pieces) {
      if (allNearer(piece, l.a.x, l.a.y, f.x, f.y) || allNearer(piece, l.b.x, l.b.y, f.x, f.y)) {
        next.push(piece);
        continue;
      }
      const nearA = keepNearer(piece, l.a.x, l.a.y, f.x, f.y);
      const nearB = keepNearer(piece, l.b.x, l.b.y, f.x, f.y);
      if (nearA.length >= 3) next.push(nearA);
      if (nearB.length >= 3) next.push(nearB);
    }
    pieces = next;
    if (pieces.length >= MAX_BAND_PIECES) {
      console.warn(`territory: a lane of country ${l.owner} is severed by too many systems`);
      break;
    }
  }
  return pieces;
}

/** Signed side of the bisector of `a` and `b`: negative or zero on `a`'s side. */
function bisectorSide(ax: number, ay: number, bx: number, by: number): (p: Pair) => number {
  const nx = bx - ax;
  const ny = by - ay;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  return (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
}

function allNearer(poly: Pair[], ax: number, ay: number, bx: number, by: number): boolean {
  const side = bisectorSide(ax, ay, bx, by);
  return poly.every((p) => side(p) <= 0);
}

/** Sutherland–Hodgman clip of `poly` to the half-plane of points nearer `a` than `b`. */
function keepNearer(poly: Pair[], ax: number, ay: number, bx: number, by: number): Pair[] {
  const side = bisectorSide(ax, ay, bx, by);
  const out: Pair[] = [];
  let prev = poly[poly.length - 1];
  let fPrev = side(prev);
  for (const cur of poly) {
    const fCur = side(cur);
    if (fCur <= 0) {
      if (fPrev > 0) out.push(cut(prev, cur, fPrev, fCur));
      out.push(cur);
    } else if (fPrev <= 0) {
      out.push(cut(prev, cur, fPrev, fCur));
    }
    prev = cur;
    fPrev = fCur;
  }
  return out;
}

function cut(p: Pair, q: Pair, fp: number, fq: number): Pair {
  const t = fp / (fp - fq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

export function snapRing(ring: Pair[]): Pair[] {
  const out: Pair[] = [];
  for (const [x, y] of ring) {
    const p: Pair = [Math.round(x / SNAP) * SNAP, Math.round(y / SNAP) * SNAP];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Pair {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [ax, ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return [ax + dx * t, ay + dy * t];
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function ringArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return sum / 2;
}

/** Unions the geometries at once, or one by one when the clipper gives up, leaving out only the ones it rejects. */
export function unionOf(geoms: Geom[], owner: number): MultiPolygon {
  if (geoms.length === 0) return [];
  try {
    return polygonClipping.union(geoms[0], ...geoms.slice(1));
  } catch {
    let merged: MultiPolygon = [];
    let dropped = 0;
    for (const geom of geoms) {
      try {
        merged = polygonClipping.union(merged, geom);
      } catch {
        dropped++;
      }
    }
    console.warn(`territory: left ${dropped} piece(s) of country ${owner} out of its region`);
    return merged;
  }
}

/** Outer rings of at least `MIN_RING_AREA`, unclosed; holes and slivers are dropped. */
function toRegion(mp: MultiPolygon): Region {
  const region: Region = [];
  for (const polygon of mp) {
    if (polygon.length === 0) continue;
    const outer = polygon[0].map((p) => ({ x: p[0], y: p[1] }));
    const first = outer[0];
    const last = outer[outer.length - 1];
    if (outer.length > 1 && first.x === last.x && first.y === last.y) outer.pop();
    if (outer.length >= 3 && Math.abs(ringArea(outer)) >= MIN_RING_AREA) region.push([outer]);
  }
  return region;
}

/** Uniform grid of items keyed by the cells their box covers. */
class Buckets<T> {
  private readonly cells = new Map<number, T[]>();

  constructor(private readonly size: number) {}

  add(minX: number, minY: number, maxX: number, maxY: number, item: T): void {
    const x0 = this.cellOf(minX);
    const y0 = this.cellOf(minY);
    const x1 = this.cellOf(maxX);
    const y1 = this.cellOf(maxY);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const k = key(i, j);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** Calls `fn` for every item whose cells intersect the box; an item spanning several cells repeats. */
  forEachIn(minX: number, minY: number, maxX: number, maxY: number, fn: (item: T) => void): void {
    const x0 = this.cellOf(minX);
    const y0 = this.cellOf(minY);
    const x1 = this.cellOf(maxX);
    const y1 = this.cellOf(maxY);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const bucket = this.cells.get(key(i, j));
        if (bucket) for (const item of bucket) fn(item);
      }
    }
  }

  /** Whether `forEachIn` over the box would visit an item at (`x`, `y`). */
  covers(minX: number, minY: number, maxX: number, maxY: number, x: number, y: number): boolean {
    const cx = this.cellOf(x);
    const cy = this.cellOf(y);
    return (
      cx >= this.cellOf(minX) &&
      cx <= this.cellOf(maxX) &&
      cy >= this.cellOf(minY) &&
      cy <= this.cellOf(maxY)
    );
  }

  private cellOf(v: number): number {
    return Math.floor(v / this.size);
  }
}

function key(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * (CELL_OFFSET * 2) + (cy + CELL_OFFSET);
}
