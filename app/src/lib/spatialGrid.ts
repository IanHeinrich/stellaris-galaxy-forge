import type { SystemNode } from "../generated/SystemNode";

export const CELL_SIZE = 25;

const OFFSET = 1 << 15;

function cellOf(v: number): number {
  return Math.floor(v / CELL_SIZE);
}

/** One number per cell of any uniform grid, for the cells a map covers. */
export function cellKey(cx: number, cy: number): number {
  return (cx + OFFSET) * (OFFSET * 2) + (cy + OFFSET);
}

/** Uniform grid over system positions for nearest-system and range queries. Pure: no pixi. */
export class SpatialGrid {
  private cells = new Map<number, SystemNode[]>();
  private where = new Map<number, number>();
  private minCx = Infinity;
  private minCy = Infinity;
  private maxCx = -Infinity;
  private maxCy = -Infinity;

  build(systems: Iterable<SystemNode>): void {
    this.cells.clear();
    this.where.clear();
    this.minCx = this.minCy = Infinity;
    this.maxCx = this.maxCy = -Infinity;
    for (const s of systems) this.insert(s);
  }

  update(node: SystemNode): void {
    this.remove(node.id);
    this.insert(node);
  }

  remove(id: number): void {
    const k = this.where.get(id);
    if (k === undefined) return;
    const bucket = this.cells.get(k);
    if (bucket) {
      const i = bucket.findIndex((n) => n.id === id);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(k);
    }
    this.where.delete(id);
  }

  /** The closest system within `maxDist`, skipping the one with id `except`. */
  nearestSystem(x: number, y: number, maxDist: number, except?: number): SystemNode | null {
    const cx = cellOf(x);
    const cy = cellOf(y);
    const reach = Math.max(1, Math.ceil(maxDist / CELL_SIZE));
    let best: SystemNode | null = null;
    let bestD2 = maxDist * maxDist;
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (!bucket) continue;
        for (const s of bucket) {
          if (s.id === except) continue;
          const dx = s.x - x;
          const dy = s.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = s;
          }
        }
      }
    }
    return best;
  }

  /** Calls `fn` for every system inside the closed box, visiting only the cells it covers. */
  forEachIn(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    fn: (s: SystemNode) => void,
  ): void {
    const x0 = Math.max(cellOf(minX), this.minCx);
    const y0 = Math.max(cellOf(minY), this.minCy);
    const x1 = Math.min(cellOf(maxX), this.maxCx);
    const y1 = Math.min(cellOf(maxY), this.maxCy);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (!bucket) continue;
        for (const s of bucket) {
          if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) fn(s);
        }
      }
    }
  }

  /** Whether some system lies within `d` of (x, y), or strictly closer than `d` when `strict`. */
  near(x: number, y: number, d: number, strict = false): boolean {
    const d2 = d * d;
    const x0 = Math.max(cellOf(x - d), this.minCx);
    const y0 = Math.max(cellOf(y - d), this.minCy);
    const x1 = Math.min(cellOf(x + d), this.maxCx);
    const y1 = Math.min(cellOf(y + d), this.maxCy);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (!bucket) continue;
        for (const s of bucket) {
          const dx = s.x - x;
          const dy = s.y - y;
          const e2 = dx * dx + dy * dy;
          if (strict ? e2 < d2 : e2 <= d2) return true;
        }
      }
    }
    return false;
  }

  private insert(s: SystemNode): void {
    const cx = cellOf(s.x);
    const cy = cellOf(s.y);
    const k = cellKey(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(s);
    this.where.set(s.id, k);
    if (cx < this.minCx) this.minCx = cx;
    if (cx > this.maxCx) this.maxCx = cx;
    if (cy < this.minCy) this.minCy = cy;
    if (cy > this.maxCy) this.maxCy = cy;
  }
}
