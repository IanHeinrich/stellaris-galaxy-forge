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
/**
 * The influence a territory ends at, measured on the game's open-space edges and holes: 0.79 close
 * up to 0.82 zoomed out, a world unit apart, so one level serves every zoom.
 */
const EDGE = 0.8;
/**
 * How far the smooth max and min that round a territory's corners blend, in influence units:
 * where two owners' borders meet, or a border meets open space. Fitted to a corner radius of
 * about 2 world units, as measured at the game's triple junctions.
 */
const CORNER_BLEND = 0.1;
/** The most the smooth max and min together raise φ above the hard max. */
const CORNER_RISE = CORNER_BLEND / 2;
/**
 * The furthest inside the outline a band's inner edge runs, in influence units. It bounds how
 * near a border the field must be measured texel by texel, whatever band is asked for later.
 */
const MAX_BAND_DEPTH = 0.3;
/**
 * How far the band's depth rounds off into its cap, in influence units, and its slope into the
 * slope round a lone system, as a share of that slope, so the band's inner edge has no kink
 * where either takes over.
 */
const DEPTH_BLEND = 0.1;
const SLOPE_BLEND_SHARE = 0.5;
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
 * the field changes too little over that distance to cross a contour when the centre is clear of one.
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
/** A tile and two texels of its neighbours right and below: a corner's slope reads one further. */
const PAD = TILE + 2;

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
  /** Per texel: the three lowest influence distances, and the owner codes of the first two. */
  best: Float32Array;
  owner: Uint16Array;
  second: Float32Array;
  runner: Uint16Array;
  third: Float32Array;
  /** Per block, which contours can cross it, and how many blocks any can cross. */
  needs: Uint8Array;
  crossed: number;
  /**
   * Per contour, per owner code, the segments whose cells start in this tile: from edge, to
   * edge, from x, from y.
   */
  segments: Map<number, number[]>[];
}

/** The contours the field keeps: the territory's outline, and the inner edges of its band and seam. */
const OUTLINE = 0;
const BAND = 1;
const SEAM = 2;
/** What a block must be measured for: no contour, only a band's inner edge, or any. */
const CLEAR = 0;
const BANDED = 1;
const ANY = 2;
const CONTOURS = [OUTLINE, BAND, SEAM];
const BANDS = [BAND, SEAM];

/**
 * The game's territories as an influence field over the galaxy. Each owned system, each lane
 * between two systems of one owner, each unowned system and each lane between two unowned
 * systems is a source; a point's distance to it over the source's radius or thickness is s.
 * An owner's influence distance is the smooth minimum −k·ln Σ exp(−s/k) over its sources, all
 * unowned sources counting as one owner. A texel belongs to the owner nearest by that measure,
 * as territory when it is a drawn country and nearer than `EDGE`. Outlines are traced per owner
 * on the texels by marching squares, on φ = max(D − D_other, D − `EDGE`) with the max, and the
 * min over the other owners, smoothed so corners come out round. The band's inner edge is where
 * φ = −w·max(|∇φ|, 1/radius) for a band w world units wide: w inside the outline where φ falls
 * at least as steeply as round a lone system, and a fixed range of φ where it falls slower, so
 * the band widens where the field is shallow and two lobes' bands cross where they meet. The
 * seam, the band's darker outer part, is a narrower band by the same rule. The field is kept in
 * tiles, so an edit recomputes only the tiles its sources reach.
 */
export class InfluenceField {
  private readonly systems = new Map<number, TerritorySystem>();
  /** Who lists each system among its lanes, so a lane either end lists is found from both. */
  private readonly listedBy = new Map<number, Set<number>>();
  private readonly points = new Map<number, Source>();
  private readonly lanes = new Map<string, Source>();
  private readonly tiles = new Map<number, Tile>();
  /** Per contour, the tiles holding segments of each owner code. */
  private readonly outlined = CONTOURS.map(() => new Map<number, Set<number>>());
  /** Per contour, the band width it runs at in world units: 0 for the outline. */
  private readonly levels = CONTOURS.map(() => 0);
  private readonly codes = new Map<number, number>();
  private readonly ownerOf: number[] = [NaN, NaN];
  private drawnCodes = new Uint8Array(64);
  private readonly table: Float64Array;
  /** The influence distance of an owner no source of which reaches. */
  private readonly none: number;
  /** How far an owner's influence can change from a block's centre to any texel its cells reach. */
  private readonly drift: number;
  /** How steeply φ can fall at most, and how steeply it falls round a lone owned system, per world unit. */
  private readonly steepest: number;
  private readonly lone: number;
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
  private readonly outThird = new Float32Array(BLOCK * BLOCK);
  private readonly outOwner = new Uint16Array(BLOCK * BLOCK);
  private readonly outRunner = new Uint16Array(BLOCK * BLOCK);
  private readonly padBest = new Float32Array(PAD * PAD);
  private readonly padSecond = new Float32Array(PAD * PAD);
  private readonly padThird = new Float32Array(PAD * PAD);
  private readonly padOwner = new Uint16Array(PAD * PAD);
  private readonly padRunner = new Uint16Array(PAD * PAD);
  /** Per padded texel, φ of its nearest owner without the rounding, and with it, and its slope. */
  private readonly padHard = new Float32Array(PAD * PAD);
  private readonly padPhi = new Float32Array(PAD * PAD);
  private readonly padSlope = new Float32Array(PAD * PAD);
  /** Arrays for a march to remember each owner's φ and slope per texel in. */
  private readonly spare: Float32Array[] = [];

  /**
   * With `drawn`, only those owners are outlined; without, every country is. `band` and `seam`
   * are the widths in world units of the band and its seam where the field falls as steeply as
   * round a lone system; 0 traces none.
   */
  constructor(
    params: TerritoryParams,
    private readonly drawn: ReadonlySet<number> | null = null,
    band = 0,
    seam = 0,
  ) {
    this.levels[BAND] = Math.max(band, 0);
    this.levels[SEAM] = Math.max(seam, 0);
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
    // A smooth minimum of distances over radii changes by at most 1/unit per world unit.
    this.drift = ((BLOCK_REACH * TEXEL) / Math.max(unit, 1e-6)) * 1.001 + 0.005;
    // φ's slope is read from a difference along each axis, which can each reach 2/unit.
    this.steepest = (2 * Math.SQRT2) / Math.max(unit, 1e-6);
    this.lone = 1 / Math.max(this.ownedRadius, 1e-6);
  }

  reset(systems: Iterable<TerritorySystem>): void {
    for (const s of systems) this.link(s);
    const dirty = new Set<number>();
    for (const s of this.systems.values()) this.addSources(s, dirty);
    for (const key of dirty) this.raster(this.tiles.get(key) as Tile);
    for (const key of dirty) this.trace(key, CONTOURS);
  }

  /**
   * Re-contours the inner edges of the band and its seam for these widths in world units; the
   * drawn owners whose band or seam changed.
   */
  setBand(band: number, seam = 0): Set<number> {
    const out = new Set<number>();
    const widths = [Math.max(band, 0), Math.max(seam, 0)];
    if (widths[0] === this.levels[BAND] && widths[1] === this.levels[SEAM]) return out;
    this.levels[BAND] = widths[0];
    this.levels[SEAM] = widths[1];
    for (const key of this.tiles.keys()) {
      for (const code of this.trace(key, BANDS)) {
        if (this.drawnCodes[code]) out.add(this.ownerOf[code]);
      }
    }
    return out;
  }

  /** Applies moved, re-owned, re-laned and new systems and removed ones; the drawn owners whose outline or band changed. */
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
    for (const key of traced) for (const code of this.trace(key, CONTOURS)) codes.add(code);
    const out = new Set<number>();
    for (const code of codes) if (this.drawnCodes[code]) out.add(this.ownerOf[code]);
    return out;
  }

  /** Every drawn owner with an outline. */
  drawnOwners(): number[] {
    const out: number[] = [];
    for (const [code, keys] of this.outlined[OUTLINE]) {
      if (keys.size > 0 && this.drawnCodes[code]) out.push(this.ownerOf[code]);
    }
    return out;
  }

  /** The owner's territory, its rings stitched from every tile's segments. */
  region(owner: number): Region {
    return this.contoured(owner, OUTLINE);
  }

  /** The part of the owner's territory inside its band. */
  inner(owner: number): Region {
    return this.contoured(owner, BAND);
  }

  /** The part of the owner's territory inside its seam. */
  seamInner(owner: number): Region {
    return this.contoured(owner, SEAM);
  }

  private contoured(owner: number, contour: number): Region {
    const code = this.codes.get(owner);
    const keys = code === undefined ? undefined : this.outlined[contour].get(code);
    if (code === undefined || !keys || keys.size === 0) return [];
    const parts: number[][] = [];
    let count = 0;
    for (const key of keys) {
      const part = (this.tiles.get(key) as Tile).segments[contour].get(code) as number[];
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
    tile.crossed = 0;
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
        this.measure(near, cx, cy, 1, TEXEL);
        const need = this.need(this.outBest[0], this.outOwner[0], this.outSecond[0]);
        tile.needs[bj * BLOCKS + bi] = need;
        tile.crossed += need === CLEAR ? 0 : 1;
        if (need === CLEAR) {
          this.fillBlock(tile, first);
          continue;
        }
        if (need === BANDED && this.coarse(tile, near, x0, y0, first)) continue;
        this.measure(near, x0, y0, BLOCK, TEXEL);
        for (let j = 0; j < BLOCK; j++) {
          const row = first + j * TILE;
          const from = j * BLOCK;
          tile.best.set(this.outBest.subarray(from, from + BLOCK), row);
          tile.second.set(this.outSecond.subarray(from, from + BLOCK), row);
          tile.third.set(this.outThird.subarray(from, from + BLOCK), row);
          tile.owner.set(this.outOwner.subarray(from, from + BLOCK), row);
          tile.runner.set(this.outRunner.subarray(from, from + BLOCK), row);
        }
      }
    }
  }

  /**
   * Which contours can pass within `BLOCK_REACH` of a point with these values: none, when every
   * owner's φ stays above 0 there or the owner's own stays below the deepest band; only a band's
   * inner edge, when the owner holds the whole block and its outline stays clear; or any.
   */
  private need(best: number, owner: number, second: number): number {
    const drift = this.drift;
    if (best - EDGE > drift) return CLEAR;
    if (!this.drawnCodes[owner]) {
      return second - best > 2 * drift || second - EDGE > drift ? CLEAR : ANY;
    }
    const deep = MAX_BAND_DEPTH + CORNER_RISE;
    if (second - best > 2 * drift + deep && EDGE - best > drift + deep) return CLEAR;
    if (second - best > 2 * drift + CORNER_RISE && EDGE - best > drift + CORNER_RISE) return BANDED;
    return ANY;
  }

  /**
   * Measures the block on every second texel and fills the rest in between, where only a band's
   * inner edge can pass and the field is smooth enough for that; false, measuring nothing, when
   * the owner does not hold every measured texel after all.
   */
  private coarse(tile: Tile, near: Source[], x0: number, y0: number, first: number): boolean {
    const n = BLOCK / 2 + 1;
    this.measure(near, x0, y0, n, 2 * TEXEL);
    const { outBest, outSecond, outThird, outOwner, outRunner } = this;
    const code = outOwner[0];
    for (let q = 1; q < n * n; q++) if (outOwner[q] !== code) return false;
    for (let j = 0; j < BLOCK; j++) {
      const gj = j >> 1;
      const fy = (j & 1) / 2;
      for (let i = 0; i < BLOCK; i++) {
        const gi = i >> 1;
        const fx = (i & 1) / 2;
        const a = gj * n + gi;
        const q = first + j * TILE + i;
        tile.best[q] = bilinear(outBest, a, n, fx, fy);
        tile.second[q] = bilinear(outSecond, a, n, fx, fy);
        tile.third[q] = bilinear(outThird, a, n, fx, fy);
        tile.owner[q] = code;
        tile.runner[q] = outRunner[a];
      }
    }
    return true;
  }

  /** Fills the block from `first` with the values measured at its centre. */
  private fillBlock(tile: Tile, first: number): void {
    const { best, second, third, owner, runner } = tile;
    const b = this.outBest[0];
    const s = this.outSecond[0];
    const t = this.outThird[0];
    const o = this.outOwner[0];
    const r = this.outRunner[0];
    for (let j = 0; j < BLOCK; j++) {
      const row = first + j * TILE;
      for (let q = row; q < row + BLOCK; q++) {
        best[q] = b;
        second[q] = s;
        third[q] = t;
        owner[q] = o;
        runner[q] = r;
      }
    }
  }

  /** The three best influences over an n×n grid of texels from (x0, y0), into the `out` arrays. */
  private measure(list: Source[], x0: number, y0: number, n: number, step: number): void {
    const { acc, table, outBest, outSecond, outThird, outOwner, outRunner } = this;
    const cells = n * n;
    outBest.fill(this.none, 0, cells);
    outSecond.fill(this.none, 0, cells);
    outThird.fill(this.none, 0, cells);
    outOwner.fill(NO_ONE, 0, cells);
    outRunner.fill(NO_ONE, 0, cells);
    let g = 0;
    while (g < list.length) {
      const code = list[g].code;
      acc.fill(0, 0, cells);
      for (; g < list.length && list[g].code === code; g++) {
        const { ax, ay, dx, dy, invLen2, scale, limit } = list[g];
        for (let j = 0; j < n; j++) {
          const ry = y0 + j * step - ay;
          const row = j * n;
          for (let i = 0; i < n; i++) {
            const rx = x0 + i * step - ax;
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
          outThird[q] = outSecond[q];
          outSecond[q] = outBest[q];
          outRunner[q] = outOwner[q];
          outBest[q] = v;
          outOwner[q] = code;
        } else if (v < outSecond[q]) {
          outThird[q] = outSecond[q];
          outSecond[q] = v;
          outRunner[q] = code;
        } else if (v < outThird[q]) {
          outThird[q] = v;
        }
      }
    }
  }

  /** Re-traces the tile's cells on these contours; the owner codes whose segments there changed. */
  private trace(key: number, contours: readonly number[]): Set<number> {
    const tile = this.tiles.get(key) as Tile;
    const traced = contours.filter((c) => c === OUTLINE || this.levels[c] > 0);
    const marched = tile.crossed > 0 && traced.length > 0 ? this.march(tile, key, traced) : [];
    const changed = new Set<number>();
    for (const contour of contours) {
      const segments = marched[traced.indexOf(contour)] ?? new Map<number, number[]>();
      const outlined = this.outlined[contour];
      const before = tile.segments[contour];
      for (const [code, old] of before) {
        if (!sameNumbers(old, segments.get(code))) changed.add(code);
        if (!segments.has(code)) outlined.get(code)?.delete(key);
      }
      for (const [code] of segments) {
        if (!before.has(code)) changed.add(code);
        let set = outlined.get(code);
        if (!set) outlined.set(code, (set = new Set()));
        set.add(key);
      }
      tile.segments[contour] = segments;
    }
    return changed;
  }

  /**
   * Marching squares over the cells whose top-left texel is in the tile, for each drawn owner and
   * each of `contours`: the outline, or a band's inner edge at that contour's width.
   */
  private march(tile: Tile, key: number, contours: readonly number[]): Map<number, number[]>[] {
    const best = this.padBest;
    const second = this.padSecond;
    const third = this.padThird;
    const owner = this.padOwner;
    const runner = this.padRunner;
    this.pad(tile, key);
    const drawn = this.drawnCodes;
    const outs = contours.map(() => new Map<number, number[]>());
    const widths = contours.map((c) => this.levels[c]);
    // How far inside its owner's territory, and from any other owner, a texel must be for a
    // contour to pass it by.
    // A contour's value is φ plus a depth between these, and φ is at most `CORNER_RISE` above the
    // hard max and min, so a cell whose hard φ keeps clear of the range on every corner is skipped.
    const lone = this.lone;
    const slopeBlend = lone * SLOPE_BLEND_SHARE;
    const shallowest = widths.map((w) => Math.min(w * lone, MAX_BAND_DEPTH) - DEPTH_BLEND / 4);
    const depths = widths.map(
      (w) => Math.min(w * (this.steepest + slopeBlend / 4), MAX_BAND_DEPTH) + CORNER_RISE,
    );
    const deepest = Math.max(...depths);
    const gi0 = tile.ti * TILE;
    const gj0 = tile.tj * TILE;
    const phiOf = (q: number, c: number): number => {
      let d: number;
      let other: number;
      if (owner[q] === c) {
        d = best[q];
        other = smoothMin(second[q], third[q]);
      } else if (runner[q] === c) {
        d = second[q];
        other = smoothMin(best[q], third[q]);
      } else {
        d = third[q];
        other = smoothMin(best[q], second[q]);
      }
      return smoothMax(d - other, d - EDGE);
    };
    const memo = new Map<number, Float32Array[]>();
    const arraysOf = (c: number): Float32Array[] => {
      let arrays = memo.get(c);
      if (!arrays) {
        arrays = [
          this.spare.pop() ?? new Float32Array(PAD * PAD),
          this.spare.pop() ?? new Float32Array(PAD * PAD),
        ];
        arrays[0].fill(NaN);
        arrays[1].fill(NaN);
        memo.set(c, arrays);
      }
      return arrays;
    };
    // A texel's own owner's φ and slope are kept in flat arrays, any other owner's by owner.
    const nearestPhi = this.padPhi;
    const nearestSlope = this.padSlope;
    nearestPhi.fill(NaN);
    nearestSlope.fill(NaN);
    const phiAt = (q: number, c: number): number => {
      const phi = owner[q] === c ? nearestPhi : arraysOf(c)[0];
      let v = phi[q];
      if (v !== v) phi[q] = v = phiOf(q, c);
      return v;
    };
    const valueAt = (q: number, c: number, w: number): number => {
      const v = phiAt(q, c);
      if (w === 0) return v;
      const slope = owner[q] === c ? nearestSlope : arraysOf(c)[1];
      let s = slope[q];
      if (s !== s) {
        const dx = phiAt(q + 1, c) - v;
        const dy = phiAt(q + PAD, c) - v;
        slope[q] = s = smoothMax(Math.sqrt(dx * dx + dy * dy) / TEXEL, lone, slopeBlend);
      }
      return v + smoothMin(w * s, MAX_BAND_DEPTH, DEPTH_BLEND);
    };
    const hard = this.padHard;
    const cell = (c: number, i: number, j: number, q: number, low: number, high: number) => {
      const gi = gi0 + i;
      const gj = gj0 + j;
      for (let k = 0; k < contours.length; k++) {
        if (low > -shallowest[k] || high < -depths[k]) continue;
        const w = widths[k];
        const v0 = valueAt(q, c, w);
        const v1 = valueAt(q + 1, c, w);
        const v2 = valueAt(q + PAD + 1, c, w);
        const v3 = valueAt(q + PAD, c, w);
        const index = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
        if (index === 0 || index === 15) continue;
        let cases = CASES[index];
        if (index === 5 || index === 10) {
          const joined = v0 + v1 + v2 + v3 < 0;
          cases = SADDLES[index === 5 ? (joined ? 0 : 1) : joined ? 2 : 3];
        }
        const out = outs[k];
        let list = out.get(c);
        if (!list) out.set(c, (list = []));
        for (let n = 0; n < cases.length; n += 2) {
          const a = cases[n];
          list.push(edgeId(a, gi, gj), edgeId(cases[n + 1], gi, gj));
          if (a === 0) list.push((gi + 0.5 + v0 / (v0 - v1)) * TEXEL, (gj + 0.5) * TEXEL);
          else if (a === 1) list.push((gi + 1.5) * TEXEL, (gj + 0.5 + v1 / (v1 - v2)) * TEXEL);
          else if (a === 2) list.push((gi + 0.5 + v3 / (v3 - v2)) * TEXEL, (gj + 1.5) * TEXEL);
          else list.push((gi + 0.5) * TEXEL, (gj + 0.5 + v0 / (v0 - v3)) * TEXEL);
        }
      }
    };
    for (let block = 0; block < BLOCKS * BLOCKS; block++) {
      if (tile.needs[block] === CLEAR) continue;
      const i0 = (block % BLOCKS) * BLOCK;
      const j0 = Math.floor(block / BLOCKS) * BLOCK;
      for (let j = j0; j < j0 + BLOCK; j++) {
        for (let i = i0; i < i0 + BLOCK; i++) {
          const q = j * PAD + i;
          // Past every owner's edge at all four corners, every φ is positive.
          if (
            best[q] > EDGE &&
            best[q + 1] > EDGE &&
            best[q + PAD] > EDGE &&
            best[q + PAD + 1] > EDGE
          ) {
            continue;
          }
          const a = owner[q];
          const b = owner[q + 1];
          const c = owner[q + PAD + 1];
          const d = owner[q + PAD];
          if (a === b && a === c && a === d) {
            if (!drawn[a]) continue;
            const h0 = hard[q];
            const h1 = hard[q + 1];
            const h2 = hard[q + PAD];
            const h3 = hard[q + PAD + 1];
            const high = Math.max(h0, h1, h2, h3);
            if (high < -deepest) continue;
            cell(a, i, j, q, Math.min(h0, h1, h2, h3), high);
            continue;
          }
          if (drawn[a]) cell(a, i, j, q, -Infinity, Infinity);
          if (drawn[b] && b !== a) cell(b, i, j, q, -Infinity, Infinity);
          if (drawn[c] && c !== a && c !== b) cell(c, i, j, q, -Infinity, Infinity);
          if (drawn[d] && d !== a && d !== b && d !== c) cell(d, i, j, q, -Infinity, Infinity);
        }
      }
    }
    for (const arrays of memo.values()) this.spare.push(...arrays);
    return outs;
  }

  /** Copies the tile and the first two columns and rows of its neighbours right and below into the pad. */
  private pad(tile: Tile, key: number): void {
    const right = this.tiles.get(key + 1);
    const below = this.tiles.get(key + TILE_SPAN);
    const corner = this.tiles.get(key + TILE_SPAN + 1);
    const none = this.none;
    padLayer(this.padBest, tile.best, right?.best, below?.best, corner?.best, none);
    padLayer(this.padSecond, tile.second, right?.second, below?.second, corner?.second, none);
    padLayer(this.padThird, tile.third, right?.third, below?.third, corner?.third, none);
    padLayer(this.padOwner, tile.owner, right?.owner, below?.owner, corner?.owner, NO_ONE);
    padLayer(this.padRunner, tile.runner, right?.runner, below?.runner, corner?.runner, NO_ONE);
    const { padBest, padSecond, padHard } = this;
    for (let q = 0; q < PAD * PAD; q++) {
      padHard[q] = Math.max(padBest[q] - padSecond[q], padBest[q] - EDGE);
    }
  }
}

type Texels = Float32Array | Uint16Array;

/** One layer of a tile and its neighbours' first two columns and rows, or `empty` where there is no neighbour. */
function padLayer(
  pad: Texels,
  own: Texels,
  right: Texels | undefined,
  below: Texels | undefined,
  corner: Texels | undefined,
  empty: number,
): void {
  for (let j = 0; j < TILE; j++) {
    const from = j * TILE;
    const to = j * PAD;
    pad.set(own.subarray(from, from + TILE), to);
    pad[to + TILE] = right ? right[from] : empty;
    pad[to + TILE + 1] = right ? right[from + 1] : empty;
  }
  for (let j = TILE; j < PAD; j++) {
    const from = (j - TILE) * TILE;
    const to = j * PAD;
    if (below) pad.set(below.subarray(from, from + TILE), to);
    else pad.fill(empty, to, to + TILE);
    pad[to + TILE] = corner ? corner[from] : empty;
    pad[to + TILE + 1] = corner ? corner[from + 1] : empty;
  }
}

/** The value a share `fx` and `fy` of the way from grid point `a` of an n-wide grid to the next. */
function bilinear(values: Float32Array, a: number, n: number, fx: number, fy: number): number {
  const top = values[a] + (values[a + 1] - values[a]) * fx;
  const bottom = values[a + n] + (values[a + n + 1] - values[a + n]) * fx;
  return top + (bottom - top) * fy;
}

/** The max of a and b, rounded off where they are within `blend` of each other. */
function smoothMax(a: number, b: number, blend = CORNER_BLEND): number {
  const h = blend - Math.abs(a - b);
  return h > 0 ? Math.max(a, b) + (h * h) / (4 * blend) : Math.max(a, b);
}

/** The min of a and b, rounded off likewise. */
function smoothMin(a: number, b: number, blend = CORNER_BLEND): number {
  const h = blend - Math.abs(a - b);
  return h > 0 ? Math.min(a, b) - (h * h) / (4 * blend) : Math.min(a, b);
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
    runner: new Uint16Array(TILE * TILE),
    third: new Float32Array(TILE * TILE),
    needs: new Uint8Array(BLOCKS * BLOCKS),
    crossed: 0,
    segments: CONTOURS.map(() => new Map()),
  };
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
  for (const ring of rings) ring.reverse();
  return grouped(rings);
}

/**
 * The territory less its inner part: the band, as polygons with holes. The inner region's
 * rings are turned round, so its outer rings become the band's holes and its holes, which
 * hold the territory's own, become outer rings of the band.
 */
export function bandOf(territory: Region, inner: Region): Region {
  const rings = territory.flat();
  for (const ring of inner.flat()) rings.push([...ring].reverse());
  return grouped(rings);
}

/** Anticlockwise rings as outer rings, each clockwise one a hole in the smallest that holds it. */
function grouped(rings: Pt[][]): Region {
  const outers: { ring: Pt[]; area: number; box: number[] }[] = [];
  const holes: Pt[][] = [];
  for (const ring of rings) {
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
