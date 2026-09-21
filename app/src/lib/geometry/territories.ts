import {
  affectedCountries,
  countryRegions,
  regionLabelAnchor,
  smoothRegion,
  type LabelAnchor,
  type Region,
  type TerritoryParams,
  type TerritorySystem,
} from "./territory";

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
 * it can have changed. `reset` takes a whole galaxy and answers with every bordered country's
 * shape; `apply` takes the systems an op changed or removed and answers with the countries
 * whose shape changed and the ones that lost their last system.
 */
export class Territories {
  private systems = new Map<number, TerritorySystem>();
  private params: TerritoryParams = { radius: 0, laneHalfWidth: 0 };
  private bordered = new Set<number>();

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
  ): Map<number, Shape> {
    this.systems = new Map();
    for (const s of systems) this.systems.set(s.id, s);
    this.params = params;
    this.bordered = new Set(bordered);
    return shapesOf(countryRegions(this.systems.values(), params, this.bordered));
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
    const regions = countryRegions(after.values(), this.params, affected);
    const emptied: number[] = [];
    for (const id of affected) if (!regions.has(id)) emptied.push(id);
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
}

function shapesOf(regions: ReadonlyMap<number, Region>): Map<number, Shape> {
  const shapes = new Map<number, Shape>();
  for (const [id, region] of regions) {
    shapes.set(id, { smoothed: smoothRegion(region), anchor: regionLabelAnchor(region) });
  }
  return shapes;
}
