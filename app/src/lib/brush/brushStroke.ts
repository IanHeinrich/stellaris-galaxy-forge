import { BRUSH_TOOLS, type BrushTool, type EraseTarget, type StrokeKind } from "./brushTools";
import {
  LaneIndex,
  laneSegments,
  meshWithin,
  provisionalId,
  provisionalIndex,
  strokeLanes,
  withProvisionalIds,
  type LaneMode,
} from "./lanes";
import { SAMPLE_CAP, StrokeSampler } from "./sample";
import { sweptLanes, sweptSystems } from "./sweep";
import {
  composed,
  copies,
  counterpartAt,
  imagesOfStamps,
  type Symmetry,
} from "../geometry/symmetry";
import { MESH_BETA, meshPairs, type MeshPoint } from "../geometry/mesh";
import { comparePairs, pairOf, PairSet, type Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { SegmentIndex, segmentsCross } from "../geometry/segments";
import { seeded } from "../random";
import type { SpatialGrid } from "../spatialGrid";
import { counted } from "../text";
import type { SystemNode } from "../../generated/SystemNode";

export interface BrushSettings {
  tool: BrushTool;
  /** Brush diameter, in world units. */
  size: number;
  spacing: number;
  laneMode: LaneMode;
  eraseTarget: EraseTarget;
  eraseSpecials: boolean;
  symmetry: Symmetry;
  /** The β of the lanes a paint or connect stroke adds. */
  beta: number;
}

/**
 * What a stroke does so far. A paint stroke's new points carry provisional ids -1..-n in
 * `points` order, and its lanes may join them to existing systems by their real ids. A
 * connect stroke's pairs join systems it swept.
 */
export type StrokeResult =
  | { kind: "paint"; points: Pt[]; pairs: Pair[] }
  | { kind: "erase"; doomed: number[]; kept: number[] }
  | { kind: "cut"; lanes: Pair[] }
  | { kind: "connect"; swept: number[]; pairs: Pair[] };

/** A new lane is at most this many spacings long. */
const LANE_REACH = 3;

function sorted(ids: Set<number>): number[] {
  return [...ids].sort((a, b) => a - b);
}

/** The middle of the distances from each point to its nearest neighbour among `points`. */
function medianNearest(points: readonly MeshPoint[]): number {
  const nearest = new Map<number, number>();
  const at = new Map(points.map((p) => [p.id, p]));
  for (const [a, b] of meshPairs([...points], MESH_BETA.dense)) {
    const p = at.get(a)!;
    const q = at.get(b)!;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    nearest.set(a, Math.min(nearest.get(a) ?? Infinity, d));
    nearest.set(b, Math.min(nearest.get(b) ?? Infinity, d));
  }
  const lengths = [...nearest.values()].sort((x, y) => x - y);
  return lengths.length === 0 ? 0 : lengths[Math.floor(lengths.length / 2)];
}

/** The galaxy a stroke is laid over, fixed at its start, and what each kind of stroke asks of it. */
class StrokeGround {
  readonly r: number;
  private laneIndex: LaneIndex | null = null;

  constructor(
    readonly settings: BrushSettings,
    readonly systems: ReadonlyMap<number, SystemNode>,
    readonly grid: SpatialGrid,
  ) {
    this.r = settings.size / 2;
  }

  get symmetric(): boolean {
    return copies(this.settings.symmetry) > 1;
  }

  /** The stamps and every image of them. */
  images(stamps: readonly Pt[]): Pt[] {
    return imagesOfStamps(stamps, this.settings.symmetry).flat();
  }

  /** The existing lanes whose bounding box comes within `d` of some point. */
  lanesNear(points: readonly Pt[], d: number): Array<[MeshPoint, MeshPoint]> {
    this.laneIndex ??= new LaneIndex(laneSegments(this.systems.values()));
    return this.laneIndex.near(points, d);
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
   * `pairs`, each mapped onto every copy, where a painted point's copies are `count` apart. A
   * lane goes in with all its images or not at all: dropped when an image would cross a lane,
   * would end at a system the galaxy lacks at that image, or is one `keep` refuses. Shortest
   * first, so a long lane gives way to a short one.
   */
  symmetricLanes(
    pairs: readonly Pair[],
    count: number,
    at: (id: number) => Pt,
    existing: ReadonlyArray<readonly [Pt, Pt]>,
    keep: (a: number, b: number) => boolean = () => true,
  ): Pair[] {
    const length = ([a, b]: Pair) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    const lanes = new SegmentIndex();
    for (const [a, b] of existing) lanes.add(a, b);
    const seen = new PairSet();
    const out: Pair[] = [];
    for (const pair of [...pairs].sort((p, q) => length(p) - length(q))) {
      if (seen.has(...pair)) continue;
      const orbit = this.orbit(pair, count);
      if (!orbit) continue;
      for (const [a, b] of orbit) seen.add(a, b);
      if (!orbit.every(([a, b]) => keep(a, b))) continue;
      const crossing = orbit.some(
        ([a, b], i) =>
          lanes.crosses(at(a), at(b)) ||
          orbit.slice(0, i).some(([c, d]) => segmentsCross(at(a), at(b), at(c), at(d))),
      );
      if (crossing) continue;
      for (const [a, b] of orbit) lanes.add(at(a), at(b));
      out.push(...orbit);
    }
    return out.sort(comparePairs);
  }

  /** `pair` and its images, each once; null when some image has no system at one end. */
  private orbit(pair: Pair, count: number): Pair[] | null {
    const found = new PairSet();
    for (let m = 0; m < copies(this.settings.symmetry); m++) {
      const a = this.imageEnd(pair[0], m, count);
      const b = this.imageEnd(pair[1], m, count);
      if (a === null || b === null || a === b) return null;
      found.add(a, b);
    }
    return [...found.values()];
  }

  /** Image `m` of a lane end: a new point's id in the copy it lands in, or the existing system there. */
  private imageEnd(id: number, m: number, count: number): number | null {
    if (m === 0) return id;
    const sym = this.settings.symmetry;
    if (id < 0) {
      const i = provisionalIndex(id);
      return provisionalId(composed(sym, m, Math.floor(i / count)) * count + (i % count));
    }
    const s = this.systems.get(id);
    return s ? counterpartAt(this.grid, s, sym, m) : null;
  }
}

/** One kind of stroke: what its stamps take in, and what it would do so far. */
interface Strategy {
  add(stamps: readonly Pt[]): void;
  result(): StrokeResult;
}

class PaintStroke implements Strategy {
  private readonly sampler: StrokeSampler;
  private painted: { base: number; result: StrokeResult } | null = null;

  constructor(
    private readonly ground: StrokeGround,
    seed: number,
  ) {
    const { r, settings, grid } = ground;
    this.sampler = new StrokeSampler({
      r,
      spacing: settings.spacing,
      blockers: grid,
      rand: seeded(seed),
      cap: Math.floor(SAMPLE_CAP / copies(settings.symmetry)),
      symmetry: settings.symmetry,
    });
  }

  add(stamps: readonly Pt[]): void {
    this.sampler.add(stamps);
  }

  /** Re-meshed only when the stroke has placed new points. */
  result(): StrokeResult {
    const base = this.sampler.points;
    if (this.painted?.base === base.length) return this.painted.result;
    const points = this.ground.images(base);
    const result: StrokeResult = { kind: "paint", points, pairs: this.lanes(base.length, points) };
    this.painted = { base: base.length, result };
    return result;
  }

  /** The stroke's lanes, where copy k of base point i is `points[k * count + i]`. */
  private lanes(count: number, points: readonly Pt[]): Pair[] {
    const ground = this.ground;
    const { laneMode: mode, beta, spacing } = ground.settings;
    if (mode === "off" || points.length === 0) return [];
    const maxLength = LANE_REACH * spacing;
    const existing = ground.lanesNear(points, maxLength);
    const pairs = strokeLanes({
      added: withProvisionalIds(points),
      nearby: mode === "nearby" ? ground.systemsNear(points.slice(0, count), maxLength) : [],
      existing,
      beta,
      mode,
      maxLength,
    }).map(([a, b]) => pairOf(a, b));
    if (!ground.symmetric) return pairs;
    const inFirst = (id: number) => id < 0 && provisionalIndex(id) < count;
    const at = (id: number): Pt =>
      id < 0 ? points[provisionalIndex(id)] : ground.systems.get(id)!;
    return ground.symmetricLanes(
      pairs.filter(([a, b]) => inFirst(a) || inFirst(b)),
      count,
      at,
      existing,
    );
  }
}

class EraseStroke implements Strategy {
  private readonly doomed = new Set<number>();
  private readonly kept = new Set<number>();

  constructor(private readonly ground: StrokeGround) {}

  add(stamps: readonly Pt[]): void {
    const { r, grid, settings } = this.ground;
    const swept = sweptSystems(this.ground.images(stamps), r, grid, {
      includeSpecials: settings.eraseSpecials,
    });
    for (const id of swept.doomed) this.doomed.add(id);
    for (const id of swept.kept) this.kept.add(id);
  }

  result(): StrokeResult {
    return { kind: "erase", doomed: sorted(this.doomed), kept: sorted(this.kept) };
  }
}

class ConnectStroke implements Strategy {
  private readonly swept = new Set<number>();
  private connected: { swept: number; result: StrokeResult } | null = null;

  constructor(private readonly ground: StrokeGround) {}

  add(stamps: readonly Pt[]): void {
    const { r, grid } = this.ground;
    // Connecting adds lanes only, so it takes special systems too.
    const reached = sweptSystems(this.ground.images(stamps), r, grid, { includeSpecials: true });
    for (const id of reached.doomed) this.swept.add(id);
  }

  /** The mesh over the swept systems, less pairs already linked or kept apart; redone only when the sweep grows. */
  result(): StrokeResult {
    if (this.connected?.swept === this.swept.size) return this.connected.result;
    const ground = this.ground;
    const systems = ground.systems;
    const swept = sorted(this.swept);
    const points = swept.flatMap((id): MeshPoint[] => {
      const s = systems.get(id);
      return s ? [{ id, x: s.x, y: s.y }] : [];
    });
    // As a paint stroke caps lanes at three spacings, with the swept systems' own spacing.
    const maxLength = LANE_REACH * medianNearest(points);
    const apart = (a: number, b: number) => {
      const s = systems.get(a);
      return !!s && (s.lanes.some((l) => l.to === b) || s.prevented.includes(b));
    };
    const existing = ground.lanesNear(points, maxLength);
    const keep = (a: number, b: number) => !apart(a, b) && !apart(b, a);
    const meshed = meshWithin(points, { beta: ground.settings.beta, maxLength, existing, keep });
    const pairs = ground.symmetric
      ? ground.symmetricLanes(meshed, 0, (id) => systems.get(id)!, existing, keep)
      : meshed;
    const result: StrokeResult = { kind: "connect", swept, pairs };
    this.connected = { swept: this.swept.size, result };
    return result;
  }
}

class CutStroke implements Strategy {
  private readonly cut = new PairSet();

  constructor(private readonly ground: StrokeGround) {}

  add(stamps: readonly Pt[]): void {
    const all = this.ground.images(stamps);
    const r = this.ground.r;
    for (const [a, b] of sweptLanes(all, r, this.ground.lanesNear(all, r))) this.cut.add(a, b);
  }

  result(): StrokeResult {
    return { kind: "cut", lanes: this.cut.sorted() };
  }
}

const STRATEGIES: Record<StrokeKind, (ground: StrokeGround, seed: number) => Strategy> = {
  paint: (ground, seed) => new PaintStroke(ground, seed),
  erase: (ground) => new EraseStroke(ground),
  connect: (ground) => new ConnectStroke(ground),
  cut: (ground) => new CutStroke(ground),
};

/**
 * One stroke of a brush over a galaxy fixed at its start. Stamps arrive as the pointer moves;
 * what they do depends only on the settings, the seed and the stamp sequence, so the preview
 * drawn from `result` is exactly what the release commits.
 */
export class BrushStroke {
  readonly r: number;
  private readonly strategy: Strategy;

  constructor(
    settings: BrushSettings,
    systems: ReadonlyMap<number, SystemNode>,
    grid: SpatialGrid,
    seed: number,
  ) {
    const ground = new StrokeGround(settings, systems, grid);
    this.r = ground.r;
    const kind = BRUSH_TOOLS[settings.tool].stroke(settings.eraseTarget);
    this.strategy = STRATEGIES[kind](ground, seed);
  }

  add(stamps: readonly Pt[]): void {
    this.strategy.add(stamps);
  }

  /** What the stroke does so far. */
  result(): StrokeResult {
    return this.strategy.result();
  }
}

/** The count the cursor carries while a stroke is held. */
export function strokeLabel(result: StrokeResult): string {
  switch (result.kind) {
    case "paint":
      return `+${counted(result.points.length, "system")} · +${counted(result.pairs.length, "lane")}`;
    case "erase":
      return result.kept.length === 0
        ? `−${counted(result.doomed.length, "system")}`
        : `−${counted(result.doomed.length, "system")} · ${result.kept.length} special kept`;
    case "cut":
      return `−${counted(result.lanes.length, "lane")}`;
    case "connect":
      return `+${counted(result.pairs.length, "lane")}`;
  }
}
