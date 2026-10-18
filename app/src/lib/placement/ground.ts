import type { SystemNode } from "../../generated/SystemNode";
import type { MeshPoint } from "../geometry/mesh";
import { comparePairs, PairSet, type Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { SegmentIndex, segmentsCross, type Segment } from "../geometry/segments";
import { copies, counterpartAt, type Symmetry } from "../geometry/symmetry";
import type { SpatialGrid } from "../spatialGrid";
import { laneIndex, provisionalId, provisionalIndex } from "./lanes";

/** The index of image `m` of new point `i` among the new points; null where it has none. */
export type ImageOfNew = (i: number, m: number) => number | null;

/** The galaxy new systems are placed into, fixed when placing begins. */
export class PlacementGround {
  private lanes: SegmentIndex<MeshPoint> | null = null;

  constructor(
    readonly systems: ReadonlyMap<number, SystemNode>,
    readonly grid: SpatialGrid,
    readonly symmetry: Symmetry,
  ) {}

  get symmetric(): boolean {
    return copies(this.symmetry) > 1;
  }

  /** The existing lanes whose bounding box comes within `d` of some point. */
  lanesNear(points: readonly Pt[], d: number): Array<Segment<MeshPoint>> {
    this.lanes ??= laneIndex(this.systems);
    return this.lanes.near(points, d);
  }

  /** The existing systems within `d` of some point. */
  systemsNear(points: readonly Pt[], d: number): MeshPoint[] {
    const found = new Map<number, MeshPoint>();
    for (const p of points) {
      this.grid.forEachWithin(p.x, p.y, d, (s) => {
        if (!found.has(s.id)) found.set(s.id, { id: s.id, x: s.x, y: s.y });
      });
    }
    return [...found.values()];
  }

  /**
   * `pairs`, each mapped onto every copy, a new point's images found by `imageOfNew`. A lane
   * goes in with all its images or not at all: dropped when an image would cross a lane, would
   * end at a system the galaxy lacks at that image, or is one `keep` refuses. Shortest first, so
   * a long lane gives way to a short one.
   */
  symmetricLanes(
    pairs: readonly Pair[],
    imageOfNew: ImageOfNew,
    at: (id: number) => Pt,
    existing: readonly Segment[],
    keep: (a: number, b: number) => boolean = () => true,
  ): Pair[] {
    const length = ([a, b]: Pair) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    const lanes = new SegmentIndex();
    for (const { a, b } of existing) lanes.add(a, b);
    const seen = new PairSet();
    const out: Pair[] = [];
    for (const pair of [...pairs].sort((p, q) => length(p) - length(q))) {
      if (seen.has(...pair)) continue;
      const orbit = this.orbit(pair, imageOfNew);
      if (!orbit) continue;
      for (const [a, b] of orbit) seen.add(a, b);
      if (this.takes(orbit, at, lanes, keep)) out.push(...orbit);
    }
    return out.sort(comparePairs);
  }

  /**
   * `pair` with all its images, as `symmetricLanes` lays a lane alone against `lanes`, which
   * takes them; empty when they don't go in.
   */
  symmetricLane(
    pair: Pair,
    imageOfNew: ImageOfNew,
    at: (id: number) => Pt,
    lanes: SegmentIndex,
    keep: (a: number, b: number) => boolean = () => true,
  ): Pair[] {
    const orbit = this.orbit(pair, imageOfNew);
    return orbit && this.takes(orbit, at, lanes, keep) ? orbit.sort(comparePairs) : [];
  }

  /** Whether `orbit` goes in, crossing no lane of `lanes` nor itself, and adds it to `lanes` when it does. */
  private takes(
    orbit: readonly Pair[],
    at: (id: number) => Pt,
    lanes: SegmentIndex,
    keep: (a: number, b: number) => boolean,
  ): boolean {
    if (!orbit.every(([a, b]) => keep(a, b))) return false;
    const crossing = orbit.some(
      ([a, b], i) =>
        lanes.crosses(at(a), at(b)) ||
        orbit.slice(0, i).some(([c, d]) => segmentsCross(at(a), at(b), at(c), at(d))),
    );
    if (crossing) return false;
    for (const [a, b] of orbit) lanes.add(at(a), at(b));
    return true;
  }

  /** `pair` and its images, each once; null when some image has no system at one end. */
  private orbit(pair: Pair, imageOfNew: ImageOfNew): Pair[] | null {
    const found = new PairSet();
    for (let m = 0; m < copies(this.symmetry); m++) {
      const a = this.imageEnd(pair[0], m, imageOfNew);
      const b = this.imageEnd(pair[1], m, imageOfNew);
      if (a === null || b === null || a === b) return null;
      found.add(a, b);
    }
    return [...found.values()];
  }

  /** Image `m` of a lane end: a new point's id in the copy it lands in, or the existing system there. */
  private imageEnd(id: number, m: number, imageOfNew: ImageOfNew): number | null {
    if (m === 0) return id;
    if (id < 0) {
      const j = imageOfNew(provisionalIndex(id), m);
      return j === null ? null : provisionalId(j);
    }
    const s = this.systems.get(id);
    return s ? counterpartAt(this.grid, s, this.symmetry, m) : null;
  }
}

/** A placement ground that also counts `follow` as lanes, so the mesh never crosses them. */
export class FollowGround extends PlacementGround {
  constructor(
    private readonly inner: PlacementGround,
    private readonly follow: ReadonlyArray<Segment<MeshPoint>>,
  ) {
    super(inner.systems, inner.grid, inner.symmetry);
  }

  override lanesNear(points: readonly Pt[], d: number): Array<Segment<MeshPoint>> {
    return [...this.inner.lanesNear(points, d), ...this.follow];
  }
}

/** The last ground `groundFor` built. */
let built: PlacementGround | null = null;

/**
 * The ground over `systems`, built again only when the systems, the grid or the symmetry change:
 * the previews ask on every redraw.
 */
export function groundFor(
  systems: ReadonlyMap<number, SystemNode>,
  grid: SpatialGrid,
  symmetry: Symmetry,
): PlacementGround {
  if (built?.systems !== systems || built.grid !== grid || built.symmetry !== symmetry) {
    built = new PlacementGround(systems, grid, symmetry);
  }
  return built;
}
