import type { Rect } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import { PointGrid } from "../placement/pointGrid";
import { PoissonCore } from "../placement/poisson";
import { seeded, type Rand } from "../random";
import { cellKey } from "../spatialGrid";
import { toLocal, toWorld, type ShapeFrame } from "./frame";
import type { Lattice } from "./types";

/** A scattered fill's tile is this many spacings on a side. */
export const TILE_SPACINGS = 8;

/** One number for the seed and a tile, mixed so that neighbouring tiles share no run of draws. */
export function tileSeed(seed: number, i: number, j: number): number {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.floor(seed / 0x100000000), 0xc2b2ae35);
  h = Math.imul(h ^ (i | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15) ^ (j | 0), 0x165667b1);
  return (h ^ (h >>> 13)) | 0;
}

/** The box in `frame`'s own coordinates around the world box `bounds`. */
function localBox(frame: ShapeFrame, bounds: Rect): Rect {
  const corners = [
    { x: bounds.x0, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y0 },
    { x: bounds.x0, y: bounds.y1 },
    { x: bounds.x1, y: bounds.y1 },
  ].map((p) => toLocal(frame, p));
  return {
    x0: Math.min(...corners.map((p) => p.x)),
    y0: Math.min(...corners.map((p) => p.y)),
    x1: Math.max(...corners.map((p) => p.x)),
    y1: Math.max(...corners.map((p) => p.y)),
  };
}

function inBox(p: Pt, box: Rect): boolean {
  return p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
}

/** How near the square tile (i, j) of `side` comes to the origin. */
function tileReach(i: number, j: number, side: number): number {
  const gap = (k: number) => Math.max(0, k * side, -(k + 1) * side);
  return Math.hypot(gap(i), gap(j));
}

/**
 * The points `tile` gives each square tile of `side` the world box `bounds` touches, in world
 * coordinates and nearest the frame's origin first. Tiles are read outwards, a point given out
 * once no tile left can hold a nearer one, so a reader that stops early reads only the tiles
 * it needed.
 */
function* nearestFirst(
  side: number,
  frame: ShapeFrame,
  bounds: Rect,
  tile: (i: number, j: number) => readonly Pt[],
): Generator<Pt> {
  const box = localBox(frame, bounds);
  const tiles: Array<{ i: number; j: number; reach: number }> = [];
  for (let i = Math.floor(box.x0 / side); i <= Math.floor(box.x1 / side); i++) {
    for (let j = Math.floor(box.y0 / side); j <= Math.floor(box.y1 / side); j++) {
      tiles.push({ i, j, reach: tileReach(i, j, side) });
    }
  }
  tiles.sort((a, b) => a.reach - b.reach);
  let waiting: Array<{ p: Pt; d: number }> = [];
  for (let t = 0; t < tiles.length; t++) {
    const { i, j } = tiles[t];
    for (const local of tile(i, j)) {
      const p = toWorld(frame, local);
      if (inBox(p, bounds)) waiting.push({ p, d: Math.hypot(local.x, local.y) });
    }
    const next = t + 1 < tiles.length ? tiles[t + 1].reach : Infinity;
    if (waiting.length === 0 || next === tiles[t].reach) continue;
    waiting.sort((a, b) => a.d - b.d);
    const ready = waiting.findIndex((w) => w.d > next);
    const out = ready < 0 ? waiting : waiting.slice(0, ready);
    waiting = ready < 0 ? [] : waiting.slice(ready);
    for (const w of out) yield w.p;
  }
}

/**
 * Which of the four sets a tile is sampled in. A tile is sampled after its neighbours of a
 * lower set and kept clear of their points, so the tiles meet without crowding, and no two
 * tiles of one set touch.
 */
function tileSet(i: number, j: number): number {
  return (i & 1) + 2 * (j & 1);
}

/** The Poisson tiles of one seed at unit spacing, each sampled once, in the frame's own coordinates. */
class ScatterTiles {
  private readonly tiles = new Map<number, Pt[]>();

  constructor(private readonly seed: number) {}

  /** The points of tile (i, j), which depend only on the seed and the tile. */
  points(i: number, j: number): Pt[] {
    const key = cellKey(i, j);
    let found = this.tiles.get(key);
    if (!found) {
      found = this.sample(i, j);
      this.tiles.set(key, found);
    }
    return found;
  }

  private sample(i: number, j: number): Pt[] {
    const set = tileSet(i, j);
    const blockers: Pt[] = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if ((di !== 0 || dj !== 0) && tileSet(i + di, j + dj) < set) {
          blockers.push(...this.points(i + di, j + dj));
        }
      }
    }
    const t = TILE_SPACINGS;
    const x0 = i * t;
    const y0 = j * t;
    const rand = seeded(tileSeed(this.seed, i, j));
    const core = new PoissonCore({
      spacing: 1,
      blockers,
      rand,
      cap: Infinity,
      inside: (c) => c.x >= x0 && c.x < x0 + t && c.y >= y0 && c.y < y0 + t,
    });
    core.seed(() => ({ x: x0 + rand() * t, y: y0 + rand() * t }));
    return core.points.map(({ x, y }) => ({ x, y }));
  }
}

/** How many seeds' tiles `scatterPattern` keeps between calls. */
const KEPT_TILES = 8;

const keptTiles = new Map<number, ScatterTiles>();

/**
 * The tiles of `seed`, sampled at unit spacing and kept for the seeds read most recently, so a
 * shape that moves or resizes reuses them; a pattern scales them by its spacing.
 */
function tilesOf(seed: number): ScatterTiles {
  let tiles = keptTiles.get(seed);
  if (tiles) keptTiles.delete(seed);
  else tiles = new ScatterTiles(seed);
  keptTiles.set(seed, tiles);
  if (keptTiles.size > KEPT_TILES) keptTiles.delete(keptTiles.keys().next().value as number);
  return tiles;
}

/**
 * A Poisson-disc pattern `spacing` apart over the world box `bounds`, nearest the frame's
 * origin first and made as it is read. It is tiled in the shape's own frame, each tile drawn
 * from the seed and the tile alone, so a larger box keeps every point of a smaller one and the
 * pattern moves and turns with the shape.
 */
export function scatterPattern(
  seed: number,
  spacing: number,
  frame: ShapeFrame,
  bounds: Rect,
): Generator<Pt> {
  if (!(spacing > 0)) return nearestFirst(1, frame, bounds, () => []);
  const tiles = tilesOf(seed);
  return nearestFirst(TILE_SPACINGS * spacing, frame, bounds, (i, j) =>
    tiles.points(i, j).map((p) => ({ x: p.x * spacing, y: p.y * spacing })),
  );
}

/** How finely a fill point's place is told apart for its draws, in parts of the spacing. */
const POINT_GRAIN = 1000;

/**
 * The draws for fill point `p`, laid `spacing` apart in `frame`, from `seed` and `stream` and
 * where `p` stands in the frame in spacings. A point keeps its draws as the shape moves, turns,
 * grows and is spaced afresh, so the preview and the placed systems agree.
 */
export function pointDraws(
  seed: number,
  stream: number,
  frame: ShapeFrame,
  spacing: number,
  p: Pt,
): Rand {
  const local = toLocal(frame, p);
  const i = Math.round((local.x * POINT_GRAIN) / spacing);
  const j = Math.round((local.y * POINT_GRAIN) / spacing);
  return seeded(tileSeed(seed ^ stream, i, j));
}

/** The least share of a fill a point is laid at; below it none is, as it would stand alone. */
const LEAST_SHARE = 0.02;

/**
 * The least and most a thinned pattern's point keeps clear of the others, as shares of what its
 * share asks, drawn at random so the pattern reads as scattered rather than packed.
 */
export const THINNED_ROOM = { least: 0.75, most: 1.5 } as const;

/** Keeps the room's draws apart from the pattern's and the extras', which read the same seed. */
const ROOM_STREAM = 0x524f_4f4d;

/**
 * Each of `points` in turn that no point kept before it lies within `room` of. A point is kept or
 * not by the points before it alone, so a reader that stops early keeps the same ones.
 */
function* keptApart(points: Iterable<Pt>, room: (p: Pt) => number, cell: number): Generator<Pt> {
  const kept = new PointGrid(cell);
  for (const p of points) {
    const r = room(p);
    if (!Number.isFinite(r)) continue;
    const near = (q: Pt) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < r * r;
    if (kept.someInBox(p.x - r, p.y - r, p.x + r, p.y + r, near)) continue;
    kept.add(p);
    yield p;
  }
}

/** How many times closer than its spacing a thinned pattern's candidates are laid. */
const CANDIDATES_PER_SPACING = 1.5;

/**
 * A scattered pattern over the world box `bounds` thinned by `share`: candidates laid closer
 * than `spacing`, each kept when no point kept before it lies within `spacing / sqrt(share)` of
 * it, scaled at random within `THINNED_ROOM`. Where the share is 1 the points keep about
 * the spacing, and where it is a quarter about twice that, so an area holds about the share of
 * the points it says, spread evenly rather than in clumps. Like `scatterPattern`, it moves and
 * turns with the frame, and a point's draw comes from where it stands in it.
 */
export function thinnedPattern(
  seed: number,
  spacing: number,
  frame: ShapeFrame,
  bounds: Rect,
  share: (p: Pt) => number,
): Generator<Pt> {
  const step = spacing / CANDIDATES_PER_SPACING;
  const room = (p: Pt) => {
    const s = Math.min(1, share(p));
    if (!(s >= LEAST_SHARE)) return Infinity;
    const { least, most } = THINNED_ROOM;
    const stretch = least + (most - least) * pointDraws(seed, ROOM_STREAM, frame, step, p)();
    return (spacing * stretch) / Math.sqrt(s);
  };
  return keptApart(scatterPattern(seed, step, frame, bounds), room, 2 * spacing);
}

/** How many tiles across the block `scatterDensity` measures is. */
const DENSITY_TILES = 8;

let measuredDensity: number | null = null;

/** How many points a scattered fill lays per square of its spacing, measured once over a block of tiles. */
export function scatterDensity(): number {
  if (measuredDensity === null) {
    const half = (DENSITY_TILES * TILE_SPACINGS) / 2;
    const box = { x0: -half, y0: -half, x1: half, y1: half };
    const frame = { origin: { x: 0, y: 0 }, rotation: 0 };
    measuredDensity = [...scatterPattern(1, 1, frame, box)].length / (2 * half) ** 2;
  }
  return measuredDensity;
}

/**
 * A square or hexagonal lattice `spacing` apart over the world box `bounds`, with a point on
 * the frame's origin, nearest it first and made as it is read.
 */
export function lattice(
  kind: Lattice,
  spacing: number,
  frame: ShapeFrame,
  bounds: Rect,
): Generator<Pt> {
  if (!(spacing > 0)) return nearestFirst(1, frame, bounds, () => []);
  const row = kind === "hex" ? (spacing * Math.sqrt(3)) / 2 : spacing;
  const side = TILE_SPACINGS * spacing;
  // Each point goes to the tile its own coordinates fall in, so none is given out twice.
  const own = (v: number, k: number) => Math.floor(v / side) === k;
  return nearestFirst(side, frame, bounds, (i, j) => {
    const out: Pt[] = [];
    for (let r = Math.floor((j * side) / row) - 1; r <= Math.ceil(((j + 1) * side) / row); r++) {
      const shift = kind === "hex" && r & 1 ? spacing / 2 : 0;
      if (!own(r * row, j)) continue;
      const c0 = Math.floor((i * side - shift) / spacing) - 1;
      for (let c = c0; c <= Math.ceil(((i + 1) * side - shift) / spacing); c++) {
        const x = c * spacing + shift;
        if (own(x, i)) out.push({ x, y: r * row });
      }
    }
    return out;
  });
}
