import type { Pt } from "../geometry/pt";
import { cellKey } from "../spatialGrid";

/** What new points keep their distance from: any index that answers "is anything near here". */
export interface Blockers {
  /** Whether something lies within `d` of (x, y), or strictly closer than `d` when `strict`. */
  near(x: number, y: number, d: number, strict?: boolean): boolean;
}

/** `blockers` as a query: a list is bucketed into a grid of `cell`, an index is used as it is. */
export function blockersOf(blockers: readonly Pt[] | Blockers, cell: number): Blockers {
  if (!Array.isArray(blockers)) return blockers as Blockers;
  const grid = new PointGrid(cell);
  for (const b of blockers as readonly Pt[]) grid.add(b);
  return grid;
}

/** Points bucketed in square cells of side `cell`, for "is anything near here" queries. */
export class PointGrid<T extends Pt = Pt> implements Blockers {
  private readonly cell: number;
  private readonly cells = new Map<number, T[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  add(p: T): void {
    const k = cellKey(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(p);
    else this.cells.set(k, [p]);
  }

  /** Whether `test` holds for some point in the cells the box touches; points outside the box may be tested too. */
  someInBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    test: (p: T) => boolean,
  ): boolean {
    const x0 = Math.floor(minX / this.cell);
    const x1 = Math.floor(maxX / this.cell);
    const y0 = Math.floor(minY / this.cell);
    const y1 = Math.floor(maxY / this.cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (bucket && bucket.some(test)) return true;
      }
    }
    return false;
  }

  /** Whether some point lies within `d` of (x, y), or strictly closer than `d` when `strict`. */
  near(x: number, y: number, d: number, strict = false): boolean {
    const d2 = d * d;
    return this.someInBox(x - d, y - d, x + d, y + d, (p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const e2 = dx * dx + dy * dy;
      return strict ? e2 < d2 : e2 <= d2;
    });
  }
}
