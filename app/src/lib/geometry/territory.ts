import type { Pt } from "./pt";

/** Multipolygon: polygons → rings (the outer ring, then its holes) → unclosed points. */
export type Region = Pt[][][];

/** What the territory maths reads of a system; a `SystemNode` is one. */
export interface TerritorySystem {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly owner: number | null;
  readonly lanes: readonly { readonly to: number }[];
}

/** The `NGraphics` defines territories are shaped by, in world units; unset ones are vanilla's. */
export interface TerritoryParams {
  /** `BORDER_SYSTEM_RADIUS`: the unit an owned system's influence falls off in. */
  radius: number;
  /** Half of `BORDER_HYPERLANE_THICKNESS`, the unit of a lane between two systems of one owner. */
  laneHalfWidth: number;
  /** `BORDER_OWNERLESS_SYSTEM_RADIUS`. */
  ownerlessRadius?: number;
  /** `BORDER_OWNERLESS_HYPERLANE_THICKNESS`, for a lane between two unowned systems. */
  ownerlessLaneThickness?: number;
  /** `BORDER_INFLUENCE_MAX_DISTANCE_FACTOR`: how many of its units an owned source reaches. */
  reachFactor?: number;
  /** `BORDER_OWNERLESS_INFLUENCE_MAX_DISTANCE_FACTOR`, likewise for an unowned one. */
  ownerlessReachFactor?: number;
}

const VANILLA_OWNERLESS_RADIUS = 30;
const VANILLA_OWNERLESS_LANE_THICKNESS = 20;
const VANILLA_REACH_FACTOR = 1.88;

/** World units per texel of the influence field. */
const TEXEL = 0.5;
/** Texels along a side of a tile, the unit the field is kept and recomputed in. */
const TILE = 64;
/** Texels along a side of a block, the unit a tile skips when it lies deep inside one owner. */
const BLOCK = 8;
const BLOCKS = TILE / BLOCK;
/** The smooth-min's softness, fitted to the holes and corridors of the game's borders. */
const SOFTNESS = 0.155;
/** The influence a territory ends at: the border shader's 0.47 of the 1.88 reach. */
const EDGE = 0.88;
/** Rings smaller than this, in world units², are slivers and are dropped. */
const MIN_RING_AREA = 25;
/** An outline point this close to the line through the points kept either side of it is dropped. */
const SIMPLIFY_TOLERANCE = 0.05;
/** Crossings of every this many texel rows and columns are always kept, so neighbours simplify a shared border alike. */
const ANCHOR_SPACING = 16;
/** Entries of the falloff table per unit of distance over softness. */
const FALLOFF_STEPS = 256;
/**
 * From a block's centre to the farthest texel an edge of one of its texels reaches, in texels:
 * the field changes too little over that distance to cross a border when the centre is clear of one.
 */
const BLOCK_REACH = Math.hypot(BLOCK / 2 + 0.5, BLOCK / 2 - 0.5);
const BLOCK_RADIUS = Math.SQRT2 * ((BLOCK - 1) / 2) * TEXEL;

/** Owner codes: no source reaches the texel, and every unowned source together. */
const NO_ONE = 0;
const UNOWNED = 1;

const TEXEL_OFFSET = 2 ** 20;
const TEXEL_SPAN = 2 ** 21;
const TILE_OFFSET = 2 ** 14;
const TILE_SPAN = 2 ** 15;
const PAD = TILE + 1;

/** A system or a lane, and how its influence falls off. */
interface Source {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  /** 1 / length², 0 for a system. */
  invLen2: number;
  /** Turns a distance into a position in the falloff table. */
  scale: number;
  /** The table position at the source's reach, beyond which it gives nothing. */
  limit: number;
  /** The reach in world units, a texel more than the falloff's so a border's neighbours share it. */
  reach: number;
  code: number;
  tiles: number[];
}

interface Tile {
  ti: number;
  tj: number;
  sources: Source[];
  sorted: boolean;
  /** Per texel: the lowest influence distance, its owner's code, and the lowest of any other owner. */
  best: Float32Array;
  owner: Uint16Array;
  second: Float32Array;
  /** Per owner code, the outline segments whose cells start in this tile: from edge, to edge, from x, from y. */
  segments: Map<number, number[]>;
}

/**
 * The game's territories as an influence field over the galaxy. Each owned system, each lane
 * between two systems of one owner, each unowned system and each lane between two unowned
 * systems is a source; a point's distance to it over the source's radius or thickness is s.
 * An owner's influence distance is the smooth minimum −k·ln Σ exp(−s/k) over its sources, all
 * unowned sources counting as one owner. A texel belongs to the owner nearest by that measure,
 * as territory when it is a drawn country and nearer than `EDGE`. Outlines are traced per owner
 * on the texels by marching squares. The field is kept in tiles, so an edit recomputes only the
 * tiles its sources reach.
 */
export class InfluenceField {
  private readonly systems = new Map<number, TerritorySystem>();
  /** Who lists each system among its lanes, so a lane either end lists is found from both. */
  private readonly listedBy = new Map<number, Set<number>>();
  private readonly points = new Map<number, Source>();
  private readonly lanes = new Map<string, Source>();
  private readonly tiles = new Map<number, Tile>();
  /** The tiles holding segments of each owner code. */
  private readonly outlined = new Map<number, Set<number>>();
  private readonly codes = new Map<number, number>();
  private readonly ownerOf: number[] = [NaN, NaN];
  private drawnCodes = new Uint8Array(64);
  private readonly table: Float64Array;
  /** The influence distance of an owner no source of which reaches. */
  private readonly none: number;
  /** How far a block's centre must be from a border for the block to be skipped. */
  private readonly margin: number;
  private readonly ownedRadius: number;
  private readonly ownedLane: number;
  private readonly ownerlessRadius: number;
  private readonly ownerlessLane: number;
  private readonly ownedFactor: number;
  private readonly ownerlessFactor: number;
  private readonly near: Source[] = [];
  private readonly acc = new Float64Array(BLOCK * BLOCK);
  private readonly outBest = new Float32Array(BLOCK * BLOCK);
  private readonly outSecond = new Float32Array(BLOCK * BLOCK);
  private readonly outOwner = new Uint16Array(BLOCK * BLOCK);
  private readonly padBest = new Float32Array(PAD * PAD);
  private readonly padSecond = new Float32Array(PAD * PAD);
  private readonly padOwner = new Uint16Array(PAD * PAD);

  /** With `drawn`, only those owners are outlined; without, every country is. */
  constructor(
    params: TerritoryParams,
    private readonly drawn: ReadonlySet<number> | null = null,
  ) {
    this.ownedRadius = params.radius;
    this.ownedLane = 2 * params.laneHalfWidth;
    this.ownerlessRadius = params.ownerlessRadius ?? VANILLA_OWNERLESS_RADIUS;
    this.ownerlessLane = params.ownerlessLaneThickness ?? VANILLA_OWNERLESS_LANE_THICKNESS;
    this.ownedFactor = params.reachFactor ?? VANILLA_REACH_FACTOR;
    this.ownerlessFactor = params.ownerlessReachFactor ?? VANILLA_REACH_FACTOR;
    this.none = Math.max(this.ownedFactor, this.ownerlessFactor);
    const size = Math.ceil((this.none / SOFTNESS) * FALLOFF_STEPS) + 2;
    this.table = Float64Array.from({ length: size }, (_, i) => Math.exp(-i / FALLOFF_STEPS));
    const unit = Math.min(
      this.ownedRadius,
      this.ownedLane,
      this.ownerlessRadius,
      this.ownerlessLane,
    );
    // φ is the difference of two smooth minima, each changing by at most 1/unit per world unit.
    this.margin = ((2 * BLOCK_REACH * TEXEL) / Math.max(unit, 1e-6)) * 1.001 + 0.01;
  }

  reset(systems: Iterable<TerritorySystem>): void {
    for (const s of systems) this.link(s);
    const dirty = new Set<number>();
    for (const s of this.systems.values()) this.addSources(s, dirty);
    for (const key of dirty) this.raster(this.tiles.get(key) as Tile);
    for (const key of dirty) this.trace(key);
  }

  /** Applies moved, re-owned, re-laned and new systems and removed ones; the drawn owners whose outline changed. */
  update(changed: readonly TerritorySystem[], removed: readonly number[]): Set<number> {
    const dirty = new Set<number>();
    const touched = [...changed.map((s) => s.id), ...removed];
    for (const id of touched) this.dropSources(id, dirty);
    for (const id of removed) this.unlink(id);
    for (const s of changed) {
      this.unlink(s.id);
      this.link(s);
    }
    for (const s of changed) this.addSources(s, dirty);
    for (const key of dirty) this.raster(this.tiles.get(key) as Tile);
    const traced = new Set<number>();
    for (const key of dirty) {
      for (const k of [key, key - 1, key - TILE_SPAN, key - TILE_SPAN - 1]) {
        if (this.tiles.has(k)) traced.add(k);
      }
    }
    const codes = new Set<number>();
    for (const key of traced) for (const code of this.trace(key)) codes.add(code);
    const out = new Set<number>();
    for (const code of codes) if (this.drawnCodes[code]) out.add(this.ownerOf[code]);
    return out;
  }

  /** Every drawn owner with an outline. */
  drawnOwners(): number[] {
    const out: number[] = [];
    for (const [code, keys] of this.outlined) {
      if (keys.size > 0 && this.drawnCodes[code]) out.push(this.ownerOf[code]);
    }
    return out;
  }

  /** The owner's territory, its rings stitched from every tile's segments. */
  region(owner: number): Region {
    const code = this.codes.get(owner);
    const keys = code === undefined ? undefined : this.outlined.get(code);
    if (code === undefined || !keys || keys.size === 0) return [];
    const parts: number[][] = [];
    let count = 0;
    for (const key of keys) {
      const part = (this.tiles.get(key) as Tile).segments.get(code) as number[];
      parts.push(part);
      count += part.length / 4;
    }
    const from = new Float64Array(count);
    const to = new Float64Array(count);
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const at = new Map<number, number>();
    let n = 0;
    for (const part of parts) {
      for (let k = 0; k < part.length; k += 4, n++) {
        from[n] = part[k];
        to[n] = part[k + 1];
        xs[n] = part[k + 2];
        ys[n] = part[k + 3];
        at.set(part[k], n);
      }
    }
    const visited = new Uint8Array(count);
    const traced: { ring: Pt[]; first: number }[] = [];
    for (let start = 0; start < count; start++) {
      if (visited[start]) continue;
      const rx: number[] = [];
      const ry: number[] = [];
      const ids: number[] = [];
      let k: number | undefined = start;
      while (k !== undefined && !visited[k]) {
        visited[k] = 1;
        rx.push(xs[k]);
        ry.push(ys[k]);
        ids.push(from[k]);
        k = at.get(to[k]);
      }
      if (k !== start) continue;
      // Every ring starts at its lowest edge, so an edit and a rebuild give the same rings.
      let low = 0;
      for (let i = 1; i < ids.length; i++) if (ids[i] < ids[low]) low = i;
      const ring = simplified(rotated(rx, low), rotated(ry, low), rotated(ids, low));
      if (ring.length >= 3 && Math.abs(ringArea(ring)) >= MIN_RING_AREA) {
        traced.push({ ring, first: ids[low] });
      }
    }
    traced.sort((a, b) => a.first - b.first);
    return nested(traced.map((t) => t.ring));
  }

  private codeOf(owner: number | null): number {
    if (owner === null) return UNOWNED;
    let code = this.codes.get(owner);
    if (code === undefined) {
      code = this.ownerOf.length;
      this.codes.set(owner, code);
      this.ownerOf.push(owner);
      if (code >= this.drawnCodes.length) {
        const grown = new Uint8Array(this.drawnCodes.length * 2);
        grown.set(this.drawnCodes);
        this.drawnCodes = grown;
      }
      this.drawnCodes[code] = this.drawn === null || this.drawn.has(owner) ? 1 : 0;
    }
    return code;
  }

  private link(s: TerritorySystem): void {
    this.systems.set(s.id, s);
    for (const lane of s.lanes) {
      let set = this.listedBy.get(lane.to);
      if (!set) this.listedBy.set(lane.to, (set = new Set()));
      set.add(s.id);
    }
  }

  private unlink(id: number): void {
    const s = this.systems.get(id);
    if (!s) return;
    for (const lane of s.lanes) this.listedBy.get(lane.to)?.delete(id);
    this.systems.delete(id);
  }

  /** The systems a lane joins to `s`, whichever end lists it. */
  private neighbours(s: TerritorySystem): Set<number> {
    const out = new Set<number>(this.listedBy.get(s.id));
    for (const lane of s.lanes) out.add(lane.to);
    out.delete(s.id);
    return out;
  }

  private addSources(s: TerritorySystem, dirty: Set<number>): void {
    const owned = s.owner !== null;
    const radius = owned ? this.ownedRadius : this.ownerlessRadius;
    const point = this.source(s.x, s.y, s.x, s.y, radius, s.owner);
    this.points.set(s.id, point);
    this.register(point, dirty);
    for (const id of this.neighbours(s)) {
      const t = this.systems.get(id);
      if (!t || t.owner !== s.owner) continue;
      const key = laneKey(s.id, id);
      if (this.lanes.has(key)) continue;
      const thickness = owned ? this.ownedLane : this.ownerlessLane;
      const lane = this.source(s.x, s.y, t.x, t.y, thickness, s.owner);
      this.lanes.set(key, lane);
      this.register(lane, dirty);
    }
  }

  private dropSources(id: number, dirty: Set<number>): void {
    const s = this.systems.get(id);
    const point = this.points.get(id);
    if (point) {
      this.unregister(point, dirty);
      this.points.delete(id);
    }
    if (!s) return;
    for (const other of this.neighbours(s)) {
      const key = laneKey(id, other);
      const lane = this.lanes.get(key);
      if (!lane) continue;
      this.unregister(lane, dirty);
      this.lanes.delete(key);
    }
  }

  private source(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    unit: number,
    owner: number | null,
  ): Source {
    const factor = owner === null ? this.ownerlessFactor : this.ownedFactor;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    return {
      ax,
      ay,
      dx,
      dy,
      invLen2: len2 > 0 ? 1 / len2 : 0,
      scale: FALLOFF_STEPS / (unit * SOFTNESS),
      limit: (factor * FALLOFF_STEPS) / SOFTNESS,
      reach: unit * factor + TEXEL,
      code: this.codeOf(owner),
      tiles: [],
    };
  }

  /** Adds the source to every tile its reach touches. */
  private register(s: Source, dirty: Set<number>): void {
    const side = TILE * TEXEL;
    const i0 = Math.floor((Math.min(s.ax, s.ax + s.dx) - s.reach) / side);
    const i1 = Math.floor((Math.max(s.ax, s.ax + s.dx) + s.reach) / side);
    const j0 = Math.floor((Math.min(s.ay, s.ay + s.dy) - s.reach) / side);
    const j1 = Math.floor((Math.max(s.ay, s.ay + s.dy) + s.reach) / side);
    for (let tj = j0; tj <= j1; tj++) {
      for (let ti = i0; ti <= i1; ti++) {
        const x0 = ti * side;
        const y0 = tj * side;
        if (segmentRectDist2(s, x0, y0, x0 + side, y0 + side) > s.reach * s.reach) continue;
        const key = tileKey(ti, tj);
        let tile = this.tiles.get(key);
        if (!tile) this.tiles.set(key, (tile = newTile(ti, tj)));
        tile.sources.push(s);
        tile.sorted = false;
        s.tiles.push(key);
        dirty.add(key);
      }
    }
  }

  private unregister(s: Source, dirty: Set<number>): void {
    for (const key of s.tiles) {
      const tile = this.tiles.get(key) as Tile;
      const at = tile.sources.indexOf(s);
      if (at >= 0) tile.sources.splice(at, 1);
      dirty.add(key);
    }
    s.tiles = [];
  }

  /** Recomputes every texel of the tile, a whole block at once where its centre is clear of any border. */
  private raster(tile: Tile): void {
    if (!tile.sorted) {
      tile.sources.sort(bySource);
      tile.sorted = true;
    }
    const near = this.near;
    const reachPad = BLOCK_RADIUS;
    for (let bj = 0; bj < BLOCKS; bj++) {
      for (let bi = 0; bi < BLOCKS; bi++) {
        const x0 = (tile.ti * TILE + bi * BLOCK + 0.5) * TEXEL;
        const y0 = (tile.tj * TILE + bj * BLOCK + 0.5) * TEXEL;
        const cx = x0 + ((BLOCK - 1) / 2) * TEXEL;
        const cy = y0 + ((BLOCK - 1) / 2) * TEXEL;
        near.length = 0;
        for (const s of tile.sources) {
          const r = s.reach + reachPad;
          if (pointSegmentDist2(cx, cy, s) <= r * r) near.push(s);
        }
        const first = (bj * BLOCK * TILE + bi * BLOCK) | 0;
        this.measure(near, cx, cy, 1);
        if (this.clear(this.outBest[0], this.outOwner[0], this.outSecond[0])) {
          fillBlock(tile, first, this.outBest[0], this.outOwner[0], this.outSecond[0]);
          continue;
        }
        this.measure(near, x0, y0, BLOCK);
        for (let j = 0; j < BLOCK; j++) {
          const row = first + j * TILE;
          tile.best.set(this.outBest.subarray(j * BLOCK, j * BLOCK + BLOCK), row);
          tile.second.set(this.outSecond.subarray(j * BLOCK, j * BLOCK + BLOCK), row);
          tile.owner.set(this.outOwner.subarray(j * BLOCK, j * BLOCK + BLOCK), row);
        }
      }
    }
  }

  /** Whether no border can pass within `BLOCK_REACH` of a point with these values. */
  private clear(best: number, owner: number, second: number): boolean {
    if (this.drawnCodes[owner]) return second - best > this.margin && EDGE - best > this.margin;
    return Math.max(second - best, second - EDGE) > this.margin;
  }

  /** The best and second-best influence over an n×n grid of texels from (x0, y0), into the `out` arrays. */
  private measure(list: Source[], x0: number, y0: number, n: number): void {
    const { acc, table, outBest, outSecond, outOwner } = this;
    const cells = n * n;
    outBest.fill(this.none, 0, cells);
    outSecond.fill(this.none, 0, cells);
    outOwner.fill(NO_ONE, 0, cells);
    let g = 0;
    while (g < list.length) {
      const code = list[g].code;
      acc.fill(0, 0, cells);
      for (; g < list.length && list[g].code === code; g++) {
        const { ax, ay, dx, dy, invLen2, scale, limit } = list[g];
        for (let j = 0; j < n; j++) {
          const ry = y0 + j * TEXEL - ay;
          const row = j * n;
          for (let i = 0; i < n; i++) {
            const rx = x0 + i * TEXEL - ax;
            let t = (rx * dx + ry * dy) * invLen2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = rx - t * dx;
            const ey = ry - t * dy;
            const u = Math.sqrt(ex * ex + ey * ey) * scale;
            if (u >= limit) continue;
            const k = u | 0;
            acc[row + i] += table[k] + (table[k + 1] - table[k]) * (u - k);
          }
        }
      }
      for (let q = 0; q < cells; q++) {
        const a = acc[q];
        if (a <= 0) continue;
        const v = -SOFTNESS * Math.log(a);
        if (v < outBest[q]) {
          outSecond[q] = outBest[q];
          outBest[q] = v;
          outOwner[q] = code;
        } else if (v < outSecond[q]) {
          outSecond[q] = v;
        }
      }
    }
  }

  /** Re-traces the tile's cells; the owner codes whose segments there changed. */
  private trace(key: number): number[] {
    const tile = this.tiles.get(key) as Tile;
    const segments = this.march(tile, key);
    const changed: number[] = [];
    for (const [code, old] of tile.segments) {
      if (!sameNumbers(old, segments.get(code))) changed.push(code);
      if (!segments.has(code)) this.outlined.get(code)?.delete(key);
    }
    for (const [code] of segments) {
      if (!tile.segments.has(code)) changed.push(code);
      let set = this.outlined.get(code);
      if (!set) this.outlined.set(code, (set = new Set()));
      set.add(key);
    }
    tile.segments = segments;
    return changed;
  }

  /** Marching squares over the cells whose top-left texel is in the tile, for each drawn owner. */
  private march(tile: Tile, key: number): Map<number, number[]> {
    const best = this.padBest;
    const second = this.padSecond;
    const owner = this.padOwner;
    this.pad(tile, key);
    const drawn = this.drawnCodes;
    const out = new Map<number, number[]>();
    const gi0 = tile.ti * TILE;
    const gj0 = tile.tj * TILE;
    const phi = (q: number, c: number): number =>
      owner[q] === c
        ? Math.max(best[q] - second[q], best[q] - EDGE)
        : Math.max(second[q] - best[q], second[q] - EDGE);
    const cell = (c: number, i: number, j: number, q: number): void => {
      const v0 = phi(q, c);
      const v1 = phi(q + 1, c);
      const v2 = phi(q + PAD + 1, c);
      const v3 = phi(q + PAD, c);
      const index = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
      if (index === 0 || index === 15) return;
      let cases = CASES[index];
      if (index === 5 || index === 10) {
        const joined = v0 + v1 + v2 + v3 < 0;
        cases = SADDLES[index === 5 ? (joined ? 0 : 1) : joined ? 2 : 3];
      }
      let list = out.get(c);
      if (!list) out.set(c, (list = []));
      const gi = gi0 + i;
      const gj = gj0 + j;
      for (let k = 0; k < cases.length; k += 2) {
        const a = cases[k];
        list.push(edgeId(a, gi, gj), edgeId(cases[k + 1], gi, gj));
        if (a === 0) list.push((gi + 0.5 + v0 / (v0 - v1)) * TEXEL, (gj + 0.5) * TEXEL);
        else if (a === 1) list.push((gi + 1.5) * TEXEL, (gj + 0.5 + v1 / (v1 - v2)) * TEXEL);
        else if (a === 2) list.push((gi + 0.5 + v3 / (v3 - v2)) * TEXEL, (gj + 1.5) * TEXEL);
        else list.push((gi + 0.5) * TEXEL, (gj + 0.5 + v0 / (v0 - v3)) * TEXEL);
      }
    };
    for (let j = 0; j < TILE; j++) {
      for (let i = 0; i < TILE; i++) {
        const q = j * PAD + i;
        const a = owner[q];
        const b = owner[q + 1];
        const c = owner[q + PAD + 1];
        const d = owner[q + PAD];
        if (a === b && a === c && a === d) {
          if (!drawn[a]) continue;
          if (
            best[q] < EDGE &&
            best[q + 1] < EDGE &&
            best[q + PAD] < EDGE &&
            best[q + PAD + 1] < EDGE
          ) {
            continue;
          }
          cell(a, i, j, q);
          continue;
        }
        if (drawn[a]) cell(a, i, j, q);
        if (drawn[b] && b !== a) cell(b, i, j, q);
        if (drawn[c] && c !== a && c !== b) cell(c, i, j, q);
        if (drawn[d] && d !== a && d !== b && d !== c) cell(d, i, j, q);
      }
    }
    return out;
  }

  /** Copies the tile and the first column, row and texel of its neighbours right and below into the pad. */
  private pad(tile: Tile, key: number): void {
    const { padBest, padSecond, padOwner } = this;
    for (let j = 0; j < TILE; j++) {
      padBest.set(tile.best.subarray(j * TILE, j * TILE + TILE), j * PAD);
      padSecond.set(tile.second.subarray(j * TILE, j * TILE + TILE), j * PAD);
      padOwner.set(tile.owner.subarray(j * TILE, j * TILE + TILE), j * PAD);
    }
    const right = this.tiles.get(key + 1);
    for (let j = 0; j < TILE; j++) {
      const q = j * PAD + TILE;
      padBest[q] = right ? right.best[j * TILE] : this.none;
      padSecond[q] = right ? right.second[j * TILE] : this.none;
      padOwner[q] = right ? right.owner[j * TILE] : NO_ONE;
    }
    const below = this.tiles.get(key + TILE_SPAN);
    for (let i = 0; i < TILE; i++) {
      const q = TILE * PAD + i;
      padBest[q] = below ? below.best[i] : this.none;
      padSecond[q] = below ? below.second[i] : this.none;
      padOwner[q] = below ? below.owner[i] : NO_ONE;
    }
    const corner = this.tiles.get(key + TILE_SPAN + 1);
    const q = PAD * PAD - 1;
    padBest[q] = corner ? corner.best[0] : this.none;
    padSecond[q] = corner ? corner.second[0] : this.none;
    padOwner[q] = corner ? corner.owner[0] : NO_ONE;
  }
}

/**
 * The territory of every country, or with `only` of those countries alone; the systems of
 * every other owner still claim their space.
 */
export function countryRegions(
  systems: Iterable<TerritorySystem>,
  params: TerritoryParams,
  only?: ReadonlySet<number>,
): Map<number, Region> {
  const field = new InfluenceField(params, only ?? null);
  field.reset(systems);
  const regions = new Map<number, Region>();
  for (const owner of field.drawnOwners()) {
    const region = field.region(owner);
    if (region.length > 0) regions.set(owner, region);
  }
  return regions;
}

/**
 * A cell's corners are v0 top left, v1 top right, v2 bottom right, v3 bottom left; its edges
 * 0 top, 1 right, 2 bottom, 3 left. Each case lists its segments as from and to edges, with
 * the owner's side always on the same hand, so segments chain into rings.
 */
const CASES: readonly (readonly number[])[] = [
  [],
  [3, 0],
  [0, 1],
  [3, 1],
  [1, 2],
  [],
  [0, 2],
  [3, 2],
  [2, 3],
  [2, 0],
  [],
  [2, 1],
  [1, 3],
  [1, 0],
  [0, 3],
  [],
];
/** Cases 5 and 10, with the two inside corners joined through the cell or kept apart. */
const SADDLES: readonly (readonly number[])[] = [
  [3, 2, 1, 0],
  [3, 0, 1, 2],
  [0, 3, 2, 1],
  [0, 1, 2, 3],
];

/** A cell edge's id, the same from either cell that shares it: the texel it starts at and its axis. */
function edgeId(edge: number, gi: number, gj: number): number {
  const x = edge === 1 ? gi + 1 : gi;
  const y = edge === 2 ? gj + 1 : gj;
  const axis = edge === 1 || edge === 3 ? 1 : 0;
  return ((y + TEXEL_OFFSET) * TEXEL_SPAN + x + TEXEL_OFFSET) * 2 + axis;
}

function isAnchor(id: number): boolean {
  const axis = id % 2;
  const texel = (id - axis) / 2;
  const line = axis === 0 ? Math.floor(texel / TEXEL_SPAN) : texel % TEXEL_SPAN;
  return line % ANCHOR_SPACING === 0;
}

function tileKey(ti: number, tj: number): number {
  return (tj + TILE_OFFSET) * TILE_SPAN + ti + TILE_OFFSET;
}

function laneKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function newTile(ti: number, tj: number): Tile {
  return {
    ti,
    tj,
    sources: [],
    sorted: true,
    best: new Float32Array(TILE * TILE),
    owner: new Uint16Array(TILE * TILE),
    second: new Float32Array(TILE * TILE),
    segments: new Map(),
  };
}

function fillBlock(tile: Tile, first: number, best: number, owner: number, second: number): void {
  for (let j = 0; j < BLOCK; j++) {
    const row = first + j * TILE;
    tile.best.fill(best, row, row + BLOCK);
    tile.owner.fill(owner, row, row + BLOCK);
    tile.second.fill(second, row, row + BLOCK);
  }
}

/** By owner, then by place, so a tile sums its sources in the same order however it got them. */
function bySource(a: Source, b: Source): number {
  return a.code - b.code || a.ax - b.ax || a.ay - b.ay || a.dx - b.dx || a.dy - b.dy;
}

function rotated(values: number[], start: number): number[] {
  return start === 0 ? values : [...values.slice(start), ...values.slice(0, start)];
}

function sameNumbers(a: readonly number[], b: readonly number[] | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function pointSegmentDist2(px: number, py: number, s: Source): number {
  const rx = px - s.ax;
  const ry = py - s.ay;
  let t = (rx * s.dx + ry * s.dy) * s.invLen2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = rx - t * s.dx;
  const ey = ry - t * s.dy;
  return ex * ex + ey * ey;
}

/** The squared distance from the source's segment to the rectangle, 0 where they meet. */
function segmentRectDist2(s: Source, x0: number, y0: number, x1: number, y1: number): number {
  if (crossesRect(s, x0, y0, x1, y1)) return 0;
  const bx = s.ax + s.dx;
  const by = s.ay + s.dy;
  return Math.min(
    pointRectDist2(s.ax, s.ay, x0, y0, x1, y1),
    pointRectDist2(bx, by, x0, y0, x1, y1),
    pointSegmentDist2(x0, y0, s),
    pointSegmentDist2(x1, y0, s),
    pointSegmentDist2(x0, y1, s),
    pointSegmentDist2(x1, y1, s),
  );
}

function pointRectDist2(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return dx * dx + dy * dy;
}

/** Liang–Barsky: whether any of the segment lies in the rectangle. */
function crossesRect(s: Source, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const sides: [number, number][] = [
    [-s.dx, s.ax - x0],
    [s.dx, x1 - s.ax],
    [-s.dy, s.ay - y0],
    [s.dy, y1 - s.ay],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * The ring with the points between anchors thinned by Douglas–Peucker. A stretch is always
 * thinned from its anchor with the lower id, so two owners sharing it keep the same points.
 */
function simplified(xs: number[], ys: number[], ids: number[]): Pt[] {
  const n = xs.length;
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (isAnchor(ids[i])) anchors.push(i);
  if (anchors.length < 2) return xs.map((x, i) => ({ x, y: ys[i] }));
  const keep = new Uint8Array(n);
  for (const a of anchors) keep[a] = 1;
  const chain: number[] = [];
  for (let k = 0; k < anchors.length; k++) {
    const from = anchors[k];
    const to = anchors[(k + 1) % anchors.length];
    chain.length = 0;
    for (let i = from; ; i = (i + 1) % n) {
      chain.push(i);
      if (i === to) break;
    }
    if (ids[to] < ids[from]) chain.reverse();
    thin(chain, xs, ys, keep);
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: xs[i], y: ys[i] });
  return out;
}

function thin(chain: number[], xs: number[], ys: number[], keep: Uint8Array): void {
  const stack = [0, chain.length - 1];
  const tolerance2 = SIMPLIFY_TOLERANCE * SIMPLIFY_TOLERANCE;
  while (stack.length > 0) {
    const hi = stack.pop() as number;
    const lo = stack.pop() as number;
    if (hi - lo < 2) continue;
    const ax = xs[chain[lo]];
    const ay = ys[chain[lo]];
    const dx = xs[chain[hi]] - ax;
    const dy = ys[chain[hi]] - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farthest = -1;
    for (let m = lo + 1; m < hi; m++) {
      const px = xs[chain[m]] - ax;
      const py = ys[chain[m]] - ay;
      const cross = px * dy - py * dx;
      const d = len2 > 0 ? (cross * cross) / len2 : px * px + py * py;
      if (d > farthest) {
        farthest = d;
        far = m;
      }
    }
    if (farthest <= tolerance2) continue;
    keep[chain[far]] = 1;
    stack.push(lo, far, far, hi);
  }
}

/**
 * Rings sorted into polygons: the rings traced with the territory on one hand are outer
 * rings, the others holes, each in the smallest outer ring that holds it. Outer rings come out
 * anticlockwise and holes clockwise, as the map expects.
 */
function nested(rings: Pt[][]): Region {
  const outers: { ring: Pt[]; area: number; box: number[] }[] = [];
  const holes: Pt[][] = [];
  for (const ring of rings) {
    ring.reverse();
    const area = ringArea(ring);
    if (area < 0) outers.push({ ring, area: -area, box: boxOf(ring) });
    else holes.push(ring);
  }
  outers.sort((a, b) => a.area - b.area);
  const region: Region = outers.map((o) => [o.ring]);
  for (const hole of holes) {
    const p = hole[0];
    const at = outers.findIndex(
      (o) =>
        p.x >= o.box[0] &&
        p.x <= o.box[2] &&
        p.y >= o.box[1] &&
        p.y <= o.box[3] &&
        inRing(p, o.ring),
    );
    if (at >= 0) region[at].push(hole);
  }
  return region;
}

function boxOf(ring: Pt[]): number[] {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of ring) {
    if (p.x < box[0]) box[0] = p.x;
    if (p.y < box[1]) box[1] = p.y;
    if (p.x > box[2]) box[2] = p.x;
    if (p.y > box[3]) box[3] = p.y;
  }
  return box;
}

/** Whether `p` lies inside `ring`, by the even-odd rule. */
function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The ring's area, negative for an anticlockwise ring. */
export function ringArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return sum / 2;
}
