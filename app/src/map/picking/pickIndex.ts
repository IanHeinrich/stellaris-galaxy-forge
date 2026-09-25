import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { linkSegment, takesCustomLinks } from "../../lib/feLinks";
import { distToSegmentSq } from "../../lib/geometry/geometry";
import { pairKey, pairOf } from "../../lib/geometry/pairs";
import type { Pt } from "../../lib/geometry/pt";
import { cellKey } from "../../lib/spatialGrid";
import type { LaneRef } from "../../store/editorStore";
import { LaneTable } from "../laneTable";
import { addTo, deleteFrom } from "../multiMap";
import type { Systems } from "../RenderContext";
import type { MapEdge } from "./edges";

const CELL = 32;
/** Along a segment, how far apart the points are whose cells it is filed under. */
const STEP = CELL / 2;
/** A point of the segment lies within this of a filed point, so a query reaches that far further. */
const QUERY_PAD = STEP / 2;

interface Entry {
  readonly key: string;
  readonly edge: MapEdge;
  readonly a: Pt;
  readonly b: Pt;
  readonly ends: readonly [number, number];
  readonly cells: number[];
}

function cellOf(v: number): number {
  return Math.floor(v / CELL);
}

/** The lane between `a` and `b`, its lower id first. */
export function laneRef(a: number, b: number): LaneRef {
  const [lo, hi] = pairOf(a, b);
  return { a: lo, b: hi };
}

function laneKey(a: number, b: number): string {
  return `lane:${pairKey(a, b)}`;
}

function linkKey(anchor: number, system: number): string {
  return `link:${anchor}:${system}`;
}

/**
 * What pointer picking needs beyond the system grid: every lane and zone link as a segment
 * filed under the cells it crosses, and the systems that anchor a zone. Built once per galaxy
 * and patched per delta, so a pick visits only the cells around the pointer.
 */
export class PickIndex {
  private readonly cells = new Map<number, Entry[]>();
  private readonly table = new LaneTable<Entry>();
  /** Custom link id → the anchors taking links under it, and each anchor's id. */
  private readonly takers = new Map<number, Set<number>>();
  private readonly takes = new Map<number, number>();
  /** Custom link id → the systems linking to it, and the ids each system lists. */
  private readonly listers = new Map<number, Set<number>>();
  private readonly lists = new Map<number, readonly number[]>();
  private readonly zoneAnchors = new Map<number, SystemNode>();
  private systems: Systems = new Map();
  /** The cells anything has been filed under, so a wide query stops at the galaxy's edge. */
  private minCx = Infinity;
  private minCy = Infinity;
  private maxCx = -Infinity;
  private maxCy = -Infinity;

  build(systems: Systems): void {
    this.cells.clear();
    this.table.clear();
    this.takers.clear();
    this.takes.clear();
    this.listers.clear();
    this.lists.clear();
    this.zoneAnchors.clear();
    this.minCx = this.minCy = Infinity;
    this.maxCx = this.maxCy = -Infinity;
    this.systems = systems;
    for (const s of systems.values()) this.register(s);
    for (const s of systems.values()) this.derive(s);
  }

  /** Re-files what the delta's systems touch; `systems` is the galaxy with the delta applied. */
  apply(delta: GalaxyDelta, systems: Systems): void {
    this.systems = systems;
    for (const id of delta.removed ?? []) this.unregister(id);
    for (const { id } of delta.systems) {
      this.unregister(id);
      const s = systems.get(id);
      if (s) this.register(s);
    }
    const again = this.table.release(delta, (entry) => this.unfile(entry));
    for (const id of again) {
      const s = systems.get(id);
      if (s) this.derive(s);
    }
  }

  /** The systems whose zone ring can be under the pointer. */
  anchors(): Iterable<SystemNode> {
    return this.zoneAnchors.values();
  }

  /** The undirected lane closest to (x, y) within `maxDist`. */
  nearestLane(x: number, y: number, maxDist: number): LaneRef | null {
    const edge = this.nearest(x, y, maxDist, "lane");
    return edge?.kind === "lane" ? edge.lane : null;
  }

  /** The closest edge within `maxDist`, a lane before a zone's link; links only count when `links`. */
  nearestEdge(x: number, y: number, maxDist: number, links: boolean): MapEdge | null {
    return (
      this.nearest(x, y, maxDist, "lane") ?? (links ? this.nearest(x, y, maxDist, "feLink") : null)
    );
  }

  private nearest(x: number, y: number, maxDist: number, kind: MapEdge["kind"]): MapEdge | null {
    const reach = maxDist + QUERY_PAD;
    const x0 = Math.max(cellOf(x - reach), this.minCx);
    const x1 = Math.min(cellOf(x + reach), this.maxCx);
    const y0 = Math.max(cellOf(y - reach), this.minCy);
    const y1 = Math.min(cellOf(y + reach), this.maxCy);
    let bestD2 = maxDist * maxDist;
    let best: MapEdge | null = null;
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const bucket = this.cells.get(cellKey(i, j));
        if (!bucket) continue;
        for (const e of bucket) {
          if (e.edge.kind !== kind) continue;
          const d2 = distToSegmentSq(x, y, e.a.x, e.a.y, e.b.x, e.b.y);
          if (d2 < bestD2) {
            bestD2 = d2;
            best = e.edge;
          }
        }
      }
    }
    return best;
  }

  private register(s: SystemNode): void {
    if (s.fe_zone !== null) this.zoneAnchors.set(s.id, s);
    if (takesCustomLinks(s)) {
      const id = s.fe_link.id!;
      this.takes.set(s.id, id);
      addTo(this.takers, id, s.id);
    }
    if (s.fe_link.to.length > 0) {
      this.lists.set(s.id, s.fe_link.to);
      for (const id of s.fe_link.to) addTo(this.listers, id, s.id);
    }
  }

  private unregister(id: number): void {
    this.zoneAnchors.delete(id);
    const takes = this.takes.get(id);
    if (takes !== undefined) deleteFrom(this.takers, takes, id);
    this.takes.delete(id);
    for (const linkId of this.lists.get(id) ?? []) deleteFrom(this.listers, linkId, id);
    this.lists.delete(id);
  }

  /** Files every lane and link `s` is an end of that is not filed yet. */
  private derive(s: SystemNode): void {
    for (const lane of s.lanes) {
      const b = this.systems.get(lane.to);
      if (!b) {
        this.table.waitFor(lane.to, s.id);
        continue;
      }
      const key = laneKey(s.id, b.id);
      if (this.table.has(key)) continue;
      const ref = laneRef(s.id, b.id);
      const [a, z] = ref.a === s.id ? [s, b] : [b, s];
      this.file({ key, edge: { kind: "lane", lane: ref }, a, b: z, ends: [s.id, b.id], cells: [] });
    }
    for (const linkId of s.fe_link.to) {
      for (const anchor of this.takers.get(linkId) ?? []) this.fileLink(anchor, s.id);
    }
    const takes = this.takes.get(s.id);
    if (takes !== undefined) {
      for (const system of this.listers.get(takes) ?? []) this.fileLink(s.id, system);
    }
  }

  private fileLink(anchorId: number, systemId: number): void {
    if (anchorId === systemId) return;
    const key = linkKey(anchorId, systemId);
    if (this.table.has(key)) return;
    const anchor = this.systems.get(anchorId);
    const system = this.systems.get(systemId);
    const segment = anchor && system && linkSegment(anchor, system);
    if (!segment) return;
    this.file({
      key,
      edge: { kind: "feLink", anchor: anchorId, system: systemId },
      a: segment.a,
      b: segment.b,
      ends: [anchorId, systemId],
      cells: [],
    });
  }

  private file(entry: Entry): void {
    this.table.add(entry);
    const { a, b } = entry;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
    const seen = new Set<number>();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = cellOf(a.x + (b.x - a.x) * t);
      const cy = cellOf(a.y + (b.y - a.y) * t);
      const k = cellKey(cx, cy);
      if (seen.has(k)) continue;
      seen.add(k);
      this.minCx = Math.min(this.minCx, cx);
      this.maxCx = Math.max(this.maxCx, cx);
      this.minCy = Math.min(this.minCy, cy);
      this.maxCy = Math.max(this.maxCy, cy);
      entry.cells.push(k);
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = [];
        this.cells.set(k, bucket);
      }
      bucket.push(entry);
    }
  }

  /** Takes a dropped entry out of the cells it was filed under. */
  private unfile(entry: Entry): void {
    for (const k of entry.cells) {
      const bucket = this.cells.get(k);
      if (!bucket) continue;
      const i = bucket.indexOf(entry);
      if (i < 0) continue;
      bucket[i] = bucket[bucket.length - 1];
      bucket.pop();
      if (bucket.length === 0) this.cells.delete(k);
    }
  }
}
