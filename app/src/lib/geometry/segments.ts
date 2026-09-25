import { forEachCell } from "../spatialGrid";
import type { Pt } from "./pt";

/** A straight from `a` to `b`. */
export interface Segment<P extends Pt = Pt> {
  readonly a: P;
  readonly b: P;
}

/** Side of the cells a `SegmentIndex` buckets by, in world units: about one lane. */
export const SEGMENT_CELL = 50;

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether segments ab and cd cross at a point interior to both; touching or sharing an end is not a crossing. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

/** Calls `fn` with the key of every cell of side `cell` that the bounding box of ab covers. */
export function forEachSegmentCell(a: Pt, b: Pt, cell: number, fn: (key: number) => void): void {
  forEachCell(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
    cell,
    fn,
  );
}

/** Segments bucketed by the grid cells their bounding boxes cover, for crossing and nearness queries. */
export class SegmentIndex<P extends Pt = Pt> {
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly segments: Array<Segment<P>> = [];
  private readonly seen: number[] = [];
  private query = 0;

  constructor(cell = SEGMENT_CELL) {
    this.cell = cell;
  }

  add(a: P, b: P): void {
    const i = this.segments.length;
    this.segments.push({ a, b });
    this.seen.push(0);
    forEachSegmentCell(a, b, this.cell, (k) => {
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(i);
      else this.cells.set(k, [i]);
    });
  }

  crosses(a: Pt, b: Pt): boolean {
    const query = ++this.query;
    let hit = false;
    forEachSegmentCell(a, b, this.cell, (k) => {
      if (hit) return;
      for (const i of this.cells.get(k) ?? []) {
        if (this.seen[i] === query) continue;
        this.seen[i] = query;
        const { a: c, b: d } = this.segments[i];
        if (segmentsCross(a, b, c, d)) {
          hit = true;
          return;
        }
      }
    });
    return hit;
  }

  /** The segments whose bounding box comes within `d` of some point, each once. */
  near(points: readonly Pt[], d: number): Array<Segment<P>> {
    const query = ++this.query;
    const found: Array<Segment<P>> = [];
    for (const p of points) {
      forEachCell(p.x - d, p.y - d, p.x + d, p.y + d, this.cell, (k) => {
        for (const i of this.cells.get(k) ?? []) {
          if (this.seen[i] === query) continue;
          const { a, b } = this.segments[i];
          if (
            Math.max(a.x, b.x) < p.x - d ||
            Math.min(a.x, b.x) > p.x + d ||
            Math.max(a.y, b.y) < p.y - d ||
            Math.min(a.y, b.y) > p.y + d
          ) {
            continue;
          }
          this.seen[i] = query;
          found.push(this.segments[i]);
        }
      });
    }
    return found;
  }
}
