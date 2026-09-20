import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";
import polylabel from "polylabel";
import type { SystemNode } from "../../generated/SystemNode";
import type { Pt } from "./hull";

/** Multipolygon: polygons → rings (outer only, holes dropped) → unclosed points. */
export type Region = Pt[][][];

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

interface Lane {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  length: number;
  owner: number;
}

const DEFAULT_SEGMENTS = 24;
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
  systems: Iterable<SystemNode>,
  params: TerritoryParams,
  only?: ReadonlySet<number>,
): Map<number, Region> {
  const radius = params.radius;
  const segments = params.segments ?? DEFAULT_SEGMENTS;
  const byId = new Map<number, SystemNode>();
  const owned: SystemNode[] = [];
  const cell = Math.max(2 * radius, 1);
  const systemGrid = new Buckets<SystemNode>(cell);
  for (const s of systems) {
    byId.set(s.id, s);
    systemGrid.add(s.x, s.y, s.x, s.y, s);
    if (s.owner !== null) owned.push(s);
  }

  const pieces = new Map<number, Pair[][]>();
  const collect = (owner: number, piece: Pair[]): void => {
    const snapped = snapRing(piece);
    if (snapped.length < 3) return;
    const list = pieces.get(owner);
    if (list) list.push(snapped);
    else pieces.set(owner, [snapped]);
  };
  const wanted = (owner: number): boolean => only === undefined || only.has(owner);

  for (const s of owned) {
    const owner = s.owner as number;
    if (!wanted(owner)) continue;
    let disc = ngon(s.x, s.y, radius, segments);
    const reach = 2 * radius;
    systemGrid.forEachIn(s.x - reach, s.y - reach, s.x + reach, s.y + reach, (f) => {
      if (f.id === s.id || f.owner === owner) return;
      const d2 = dist2(s.x, s.y, f.x, f.y);
      if (d2 < reach * reach && d2 > EPS2) disc = keepNearer(disc, s.x, s.y, f.x, f.y);
    });
    collect(owner, disc);
  }

  for (const l of sameOwnerLanes(owned, byId)) {
    if (!wanted(l.owner)) continue;
    const band = bandOf(l, params.laneHalfWidth);
    if (band === null) continue;
    const pad = laneReach(l.length, params);
    const foreign: SystemNode[] = [];
    systemGrid.forEachIn(
      Math.min(l.ax, l.bx) - pad,
      Math.min(l.ay, l.by) - pad,
      Math.max(l.ax, l.bx) + pad,
      Math.max(l.ay, l.by) + pad,
      (f) => {
        if (f.owner !== l.owner) foreign.push(f);
      },
    );
    for (const piece of severBand(band, l, foreign)) collect(l.owner, piece);
  }

  const regions = new Map<number, Region>();
  for (const [owner, list] of pieces) {
    const region = toRegion(unionOf(list, owner));
    if (region.length > 0) regions.set(owner, region);
  }
  return regions;
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
  changed: SystemNode[],
  before: ReadonlyMap<number, SystemNode>,
  after: ReadonlyMap<number, SystemNode>,
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
  private readonly discs: Buckets<SystemNode>;
  private readonly bands: Buckets<Lane>;

  constructor(
    systems: ReadonlyMap<number, SystemNode>,
    private readonly params: TerritoryParams,
  ) {
    this.reach = 2 * params.radius;
    const cell = Math.max(this.reach, 1);
    this.discs = new Buckets(cell);
    this.bands = new Buckets(cell);
    const owned: SystemNode[] = [];
    for (const s of systems.values()) {
      if (s.owner === null) continue;
      owned.push(s);
      this.discs.add(s.x, s.y, s.x, s.y, s);
    }
    for (const l of sameOwnerLanes(owned, systems)) {
      const pad = laneReach(l.length, params);
      this.bands.add(
        Math.min(l.ax, l.bx) - pad,
        Math.min(l.ay, l.by) - pad,
        Math.max(l.ax, l.bx) + pad,
        Math.max(l.ay, l.by) + pad,
        l,
      );
    }
  }

  /** Adds `s`'s own owner, then every owner whose disc or lane band covers `s`. */
  collect(s: SystemNode, out: Set<number>): void {
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
      const q = closestOnSegment(s.x, s.y, l.ax, l.ay, l.bx, l.by);
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
function sameOwnerLanes(owned: SystemNode[], byId: ReadonlyMap<number, SystemNode>): Lane[] {
  const lanes: Lane[] = [];
  for (const a of owned) {
    for (const lane of a.lanes) {
      const b = byId.get(lane.to);
      if (!b || b.owner !== a.owner) continue;
      if (a.id > b.id && b.lanes.some((l) => l.to === a.id)) continue;
      lanes.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
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
  const nx = (-(l.by - l.ay) / l.length) * halfWidth;
  const ny = ((l.bx - l.ax) / l.length) * halfWidth;
  return [
    [l.ax - nx, l.ay - ny],
    [l.bx - nx, l.by - ny],
    [l.bx + nx, l.by + ny],
    [l.ax + nx, l.ay + ny],
  ];
}

/**
 * The band without the points nearer a `foreign` system than both ends of its lane: for each
 * such system a piece splits into the part nearer end A and the part nearer end B.
 */
function severBand(band: Pair[], l: Lane, foreign: SystemNode[]): Pair[][] {
  let pieces = [band];
  for (const f of foreign) {
    const next: Pair[][] = [];
    for (const piece of pieces) {
      if (allNearer(piece, l.ax, l.ay, f.x, f.y) || allNearer(piece, l.bx, l.by, f.x, f.y)) {
        next.push(piece);
        continue;
      }
      const nearA = keepNearer(piece, l.ax, l.ay, f.x, f.y);
      const nearB = keepNearer(piece, l.bx, l.by, f.x, f.y);
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

function snapRing(ring: Pair[]): Pair[] {
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

function ringArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return sum / 2;
}

/** Unions the pieces at once, or one by one when the clipper gives up, leaving out only the pieces it rejects. */
function unionOf(pieces: Pair[][], owner: number): MultiPolygon {
  const polygons: Polygon[] = pieces.map((ring) => [ring]);
  try {
    return polygonClipping.union(polygons[0], ...polygons.slice(1));
  } catch {
    let merged: MultiPolygon = [];
    let dropped = 0;
    for (const polygon of polygons) {
      try {
        merged = polygonClipping.union(merged, polygon);
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

  private cellOf(v: number): number {
    return Math.floor(v / this.size);
  }
}

function key(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * (CELL_OFFSET * 2) + (cy + CELL_OFFSET);
}
