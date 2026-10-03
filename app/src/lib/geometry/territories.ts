import { scanPiece, type PieceScan } from "./labelFit";
import {
  InfluenceField,
  type Region,
  type TerritoryParams,
  type TerritorySystem,
} from "./territory";

/** What the map draws of one country: its outline, and each piece of it scanned for its label. */
export interface Shape {
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
    }
  | { kind: "apply"; epoch: number; changed: TerritorySystem[]; removed: number[] };

export type Reply =
  | { kind: "reset"; epoch: number; shapes: [number, Shape][] }
  | { kind: "apply"; epoch: number; shapes: [number, Shape][]; removed: number[] };

/**
 * The territories of one galaxy, kept between edits as an influence field so a delta
 * recomputes only the tiles its systems reach. `reset` takes a whole galaxy and answers with
 * every bordered country's shape; `apply` takes the systems an op changed or removed and
 * answers with the countries whose outline changed and the ones left with none.
 */
export class Territories {
  private field: InfluenceField | null = null;

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
  ): Map<number, Shape> {
    this.field = new InfluenceField(params, new Set(bordered));
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

  /** One request answered, as the worker and the inline client both do it. */
  handle(request: Request): Reply {
    if (request.kind === "reset") {
      const shapes = this.reset(request.systems, request.params, request.bordered);
      return { kind: "reset", epoch: request.epoch, shapes: [...shapes] };
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
      else shapes.set(owner, { smoothed: region, scans: region.map((piece) => scanPiece(piece)) });
    }
    return { shapes, removed };
  }
}
