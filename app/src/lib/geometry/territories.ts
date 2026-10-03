import { scanPiece, type PieceScan } from "./labelFit";
import {
  bandOf,
  InfluenceField,
  type Region,
  type TerritoryParams,
  type TerritorySystem,
} from "./territory";

/** A country's band and seam, each the territory less its inner part, and the band's inner part. */
export interface Banding {
  band: Region;
  seam: Region;
  inner: Region;
}

/** The band's and the seam's widths in world units where the field is as steep as round a lone system. */
export interface BandWidths {
  band: number;
  seam: number;
}

export const NO_BAND: BandWidths = { band: 0, seam: 0 };

/** What the map draws of one country: its outline and band, and each piece scanned for its label. */
export interface Shape extends Banding {
  /** The outline, traced from a field smooth enough to need no rounding. */
  smoothed: Region;
  scans: PieceScan[];
}

export type Request =
  | {
      kind: "reset";
      epoch: number;
      systems: TerritorySystem[];
      params: TerritoryParams;
      bordered: number[];
      widths: BandWidths;
    }
  | { kind: "apply"; epoch: number; changed: TerritorySystem[]; removed: number[] }
  | { kind: "band"; epoch: number; widths: BandWidths };

export type Reply =
  | { kind: "reset"; epoch: number; shapes: [number, Shape][] }
  | { kind: "apply"; epoch: number; shapes: [number, Shape][]; removed: number[] }
  | { kind: "band"; epoch: number; bands: [number, Banding][] };

/**
 * The territories of one galaxy, kept between edits as an influence field so a delta
 * recomputes only the tiles its systems reach. `reset` takes a whole galaxy and answers with
 * every bordered country's shape; `apply` takes the systems an op changed or removed and
 * answers with the countries whose outline changed and the ones left with none; `band`
 * re-traces only the bands, for new widths, and answers with the countries whose band changed.
 */
export class Territories {
  private field: InfluenceField | null = null;
  private widths: BandWidths = NO_BAND;

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
    widths: BandWidths = NO_BAND,
  ): Map<number, Shape> {
    this.widths = widths;
    this.field = new InfluenceField(params, new Set(bordered), widths.band, widths.seam);
    this.field.reset(systems);
    return this.shapesOf(this.field.drawnOwners()).shapes;
  }

  apply(
    changed: TerritorySystem[],
    removed: number[],
  ): { shapes: Map<number, Shape>; removed: number[] } {
    if (!this.field) return { shapes: new Map(), removed: [] };
    return this.shapesOf(this.field.update(changed, removed));
  }

  band(widths: BandWidths): Map<number, Banding> {
    const out = new Map<number, Banding>();
    const field = this.field;
    if (!field) return out;
    this.widths = widths;
    for (const owner of field.setBand(widths.band, widths.seam)) {
      out.set(owner, this.bandingOf(owner, field.region(owner)));
    }
    return out;
  }

  /** One request answered, as the worker and the inline client both do it. */
  handle(request: Request): Reply {
    if (request.kind === "reset") {
      const { systems, params, bordered, widths } = request;
      const shapes = this.reset(systems, params, bordered, widths);
      return { kind: "reset", epoch: request.epoch, shapes: [...shapes] };
    }
    if (request.kind === "band") {
      return { kind: "band", epoch: request.epoch, bands: [...this.band(request.widths)] };
    }
    const { shapes, removed } = this.apply(request.changed, request.removed);
    return { kind: "apply", epoch: request.epoch, shapes: [...shapes], removed };
  }

  private shapesOf(owners: Iterable<number>): { shapes: Map<number, Shape>; removed: number[] } {
    const field = this.field as InfluenceField;
    const shapes = new Map<number, Shape>();
    const removed: number[] = [];
    for (const owner of owners) {
      const region = field.region(owner);
      if (region.length === 0) removed.push(owner);
      else {
        const scans = region.map((piece) => scanPiece(piece));
        shapes.set(owner, { smoothed: region, scans, ...this.bandingOf(owner, region) });
      }
    }
    return { shapes, removed };
  }

  /** None while the field traces no band. */
  private bandingOf(owner: number, region: Region): Banding {
    const field = this.field as InfluenceField;
    const inner = field.inner(owner);
    const seamInner = field.seamInner(owner);
    return {
      band: this.widths.band > 0 ? bandOf(region, inner) : [],
      seam: this.widths.seam > 0 ? bandOf(region, seamInner) : [],
      inner,
    };
  }
}
