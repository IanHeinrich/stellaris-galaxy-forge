import { stitched } from "./contour";
import { InfluenceMarch } from "./influenceMarch";
import { InfluenceRaster } from "./influenceRaster";
import {
  FALLOFF_STEPS,
  laneKey,
  segmentRectDist2,
  SOFTNESS,
  type Source,
} from "./influenceSources";
import {
  BAND,
  BANDS,
  CONTOURS,
  newTile,
  OUTLINE,
  SEAM,
  TEXEL,
  TILE,
  TILE_SPAN,
  tileKey,
  UNOWNED,
  type Contour,
  type Tile,
} from "./influenceTiles";
import type { Region } from "./polygon";

/** What the territory maths reads of a system; a `SystemNode` is one. */
export interface TerritorySystem {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly owner: number | null;
  readonly lanes: readonly { readonly to: number }[];
}

/** The `NGraphics` defines territories are shaped by, in world units. */
export interface TerritoryParams {
  /** `BORDER_SYSTEM_RADIUS`: the unit an owned system's influence falls off in. */
  radius: number;
  /** Half of `BORDER_HYPERLANE_THICKNESS`, the unit of a lane between two systems of one owner. */
  laneHalfWidth: number;
  /** `BORDER_OWNERLESS_SYSTEM_RADIUS`. */
  ownerlessRadius: number;
  /** `BORDER_OWNERLESS_HYPERLANE_THICKNESS`, for a lane between two unowned systems. */
  ownerlessLaneThickness: number;
  /** `BORDER_INFLUENCE_MAX_DISTANCE_FACTOR`: how many of its units an owned source reaches. */
  reachFactor: number;
  /** `BORDER_OWNERLESS_INFLUENCE_MAX_DISTANCE_FACTOR`, likewise for an unowned one. */
  ownerlessReachFactor: number;
}

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
  private readonly rasterizer: InfluenceRaster;
  private readonly marcher: InfluenceMarch;
  private readonly ownedRadius: number;
  private readonly ownedLane: number;
  private readonly ownerlessRadius: number;
  private readonly ownerlessLane: number;
  private readonly ownedFactor: number;
  private readonly ownerlessFactor: number;

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
    this.ownerlessRadius = params.ownerlessRadius;
    this.ownerlessLane = params.ownerlessLaneThickness;
    this.ownedFactor = params.reachFactor;
    this.ownerlessFactor = params.ownerlessReachFactor;
    const none = Math.max(this.ownedFactor, this.ownerlessFactor);
    const unit = Math.min(
      this.ownedRadius,
      this.ownedLane,
      this.ownerlessRadius,
      this.ownerlessLane,
    );
    this.rasterizer = new InfluenceRaster(none, unit);
    const lone = 1 / Math.max(this.ownedRadius, 1e-6);
    this.marcher = new InfluenceMarch(this.tiles, this.levels, none, lone);
  }

  /** Replaces every system the field holds with these. */
  reset(systems: Iterable<TerritorySystem>): void {
    this.systems.clear();
    this.listedBy.clear();
    this.points.clear();
    this.lanes.clear();
    this.tiles.clear();
    for (const outlined of this.outlined) outlined.clear();
    for (const s of systems) this.link(s);
    const dirty = new Set<number>();
    for (const s of this.systems.values()) this.addSources(s, dirty);
    for (const key of dirty) this.rasterizer.raster(this.tileAt(key), this.drawnCodes);
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
    for (const key of dirty) this.rasterizer.raster(this.tileAt(key), this.drawnCodes);
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

  private contoured(owner: number, contour: Contour): Region {
    const code = this.codes.get(owner);
    const keys = code === undefined ? undefined : this.outlined[contour].get(code);
    if (code === undefined || !keys || keys.size === 0) return [];
    return stitched([...keys].map((key) => this.tileAt(key).segments[contour].get(code) ?? []));
  }

  private tileAt(key: number): Tile {
    const tile = this.tiles.get(key);
    if (!tile) throw new Error(`no territory tile ${key}`);
    return tile;
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
      const tile = this.tileAt(key);
      const at = tile.sources.indexOf(s);
      if (at >= 0) tile.sources.splice(at, 1);
      dirty.add(key);
    }
    s.tiles = [];
  }

  /** Re-traces the tile's cells on these contours; the owner codes whose segments there changed. */
  private trace(key: number, contours: readonly Contour[]): Set<number> {
    const tile = this.tileAt(key);
    const traced = contours.filter((c) => c === OUTLINE || this.levels[c] > 0);
    const marched =
      tile.crossed > 0 && traced.length > 0
        ? this.marcher.march(tile, key, traced, this.drawnCodes)
        : [];
    const changed = new Set<number>();
    for (const contour of contours) {
      const segments = marched[contour] ?? new Map<number, number[]>();
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

function sameNumbers(a: readonly number[], b: readonly number[] | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
