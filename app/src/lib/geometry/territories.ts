import type { Geom, MultiPolygon } from "polygon-clipping";
import type { Pt } from "./pt";
import {
  affectedCountries,
  countryPieces,
  polygonsOf,
  regionLabelAnchor,
  regionOf,
  smoothRegion,
  SystemIndex,
  unionOf,
  type LabelAnchor,
  type Piece,
  type Region,
  type TerritoryParams,
  type TerritorySystem,
} from "./territory";

/** Side of the tiles a country's pieces are unioned in, in disc radii. */
const TILE_RADII = 4;

/** What the map draws of one country: its rounded outline and where its badge sits. */
export interface Shape {
  smoothed: Region;
  anchor: LabelAnchor | null;
}

export type Request =
  | {
      kind: "reset";
      epoch: number;
      systems: TerritorySystem[];
      params: TerritoryParams;
      bordered: number[];
    }
  | { kind: "apply"; epoch: number; changed: TerritorySystem[]; removed: number[] };

export type Reply =
  | { kind: "reset"; epoch: number; shapes: [number, Shape][] }
  | { kind: "apply"; epoch: number; shapes: [number, Shape][]; removed: number[] };

/**
 * The territories of one galaxy, kept between edits so a delta recomputes only the countries
 * it can have changed, and of those only the pieces a changed system reaches. `reset` takes a
 * whole galaxy and answers with every bordered country's shape; `apply` takes the systems an
 * op changed or removed and answers with the countries whose shape changed and the ones that
 * lost their last system.
 */
export class Territories {
  private systems = new Map<number, TerritorySystem>();
  private params: TerritoryParams = { radius: 0, laneHalfWidth: 0 };
  private bordered = new Set<number>();
  private tiled = new Map<number, TiledPieces>();

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
  ): Map<number, Shape> {
    this.systems = new Map();
    for (const s of systems) this.systems.set(s.id, s);
    this.params = params;
    this.bordered = new Set(bordered);
    this.tiled = new Map();
    const regions = new Map<number, Region>();
    for (const [owner, pieces] of countryPieces(this.systems.values(), params, this.bordered)) {
      const tiled = this.tiledOf(owner);
      for (const [key, piece] of pieces) tiled.set(key, piece);
      const region = tiled.region(owner);
      if (region.length > 0) regions.set(owner, region);
    }
    return shapesOf(regions);
  }

  apply(
    changed: TerritorySystem[],
    removed: number[],
  ): { shapes: Map<number, Shape>; removed: number[] } {
    const before = this.systems;
    const after = new Map(before);
    for (const id of removed) after.delete(id);
    for (const s of changed) after.set(s.id, s);
    this.systems = after;
    const gone = removed.flatMap((id) => before.get(id) ?? []);
    const affected = affectedCountries([...changed, ...gone], before, after, this.params);
    for (const id of affected) if (!this.bordered.has(id)) affected.delete(id);
    if (affected.size === 0) return { shapes: new Map(), removed: [] };

    const moved: Pt[] = [...changed, ...gone, ...changed.flatMap((s) => before.get(s.id) ?? [])];
    const index = new SystemIndex(after.values(), this.params);
    const owned = new Map<number, TerritorySystem[]>();
    for (const s of index.owned()) {
      const list = owned.get(s.owner as number);
      if (list) list.push(s);
      else owned.set(s.owner as number, [s]);
    }

    const regions = new Map<number, Region>();
    const emptied: number[] = [];
    for (const owner of affected) {
      const tiled = this.tiledOf(owner);
      tiled.refresh(index, owned.get(owner) ?? [], moved);
      const region = tiled.region(owner);
      if (region.length > 0) regions.set(owner, region);
      else emptied.push(owner);
    }
    return { shapes: shapesOf(regions), removed: emptied };
  }

  /** One request answered, as the worker and the inline client both do it. */
  handle(request: Request): Reply {
    if (request.kind === "reset") {
      const shapes = this.reset(request.systems, request.params, request.bordered);
      return { kind: "reset", epoch: request.epoch, shapes: [...shapes] };
    }
    const { shapes, removed } = this.apply(request.changed, request.removed);
    return { kind: "apply", epoch: request.epoch, shapes: [...shapes], removed };
  }

  private tiledOf(owner: number): TiledPieces {
    let tiled = this.tiled.get(owner);
    if (!tiled) this.tiled.set(owner, (tiled = new TiledPieces(TILE_RADII * this.params.radius)));
    return tiled;
  }
}

interface Tile {
  keys: Set<string>;
  /** The union of the tile's pieces, or null once one of them changed. */
  union: MultiPolygon | null;
}

/**
 * One country's pieces, each in the tile its centre falls in, with the union of each tile
 * kept so a change re-unions only the tiles it touches before the tiles are unioned into the
 * country's region.
 */
class TiledPieces {
  private readonly pieces = new Map<string, Piece>();
  private readonly tileOf = new Map<string, string>();
  private readonly tiles = new Map<string, Tile>();

  constructor(private readonly size: number) {}

  set(key: string, piece: Piece): void {
    const tileKey = `${Math.floor(piece.x / this.size)},${Math.floor(piece.y / this.size)}`;
    const was = this.tileOf.get(key);
    if (was !== undefined && was !== tileKey) this.leave(key, was);
    this.pieces.set(key, piece);
    this.tileOf.set(key, tileKey);
    let tile = this.tiles.get(tileKey);
    if (!tile) this.tiles.set(tileKey, (tile = { keys: new Set(), union: null }));
    tile.keys.add(key);
    tile.union = null;
  }

  delete(key: string): void {
    const was = this.tileOf.get(key);
    if (was === undefined) return;
    this.leave(key, was);
    this.pieces.delete(key);
    this.tileOf.delete(key);
  }

  /**
   * Regenerates every piece of `owned` that a system at one of the `moved` points clips or
   * severs, and drops the pieces whose system or lane is gone.
   */
  refresh(index: SystemIndex, owned: TerritorySystem[], moved: Pt[]): void {
    const live = new Set<string>();
    for (const s of owned) {
      const key = String(s.id);
      live.add(key);
      if (moved.some((p) => index.clipsDisc(s, p.x, p.y))) this.set(key, index.disc(s));
    }
    for (const l of index.lanes(owned)) {
      live.add(l.key);
      if (moved.some((p) => index.seversBand(l, p.x, p.y))) this.set(l.key, index.band(l));
    }
    for (const key of [...this.pieces.keys()]) if (!live.has(key)) this.delete(key);
  }

  region(owner: number): Region {
    const unions: Geom[] = [];
    for (const [tileKey, tile] of this.tiles) {
      if (tile.keys.size === 0) {
        this.tiles.delete(tileKey);
        continue;
      }
      if (tile.union === null) {
        const pieces = [...tile.keys].map((key) => this.pieces.get(key) as Piece);
        tile.union = unionOf(polygonsOf(pieces), owner);
      }
      if (tile.union.length > 0) unions.push(tile.union);
    }
    return regionOf(unions, owner);
  }

  private leave(key: string, tileKey: string): void {
    const tile = this.tiles.get(tileKey);
    if (!tile) return;
    tile.keys.delete(key);
    tile.union = null;
  }
}

function shapesOf(regions: ReadonlyMap<number, Region>): Map<number, Shape> {
  const shapes = new Map<number, Shape>();
  for (const [id, region] of regions) {
    shapes.set(id, { smoothed: smoothRegion(region), anchor: regionLabelAnchor(region) });
  }
  return shapes;
}
