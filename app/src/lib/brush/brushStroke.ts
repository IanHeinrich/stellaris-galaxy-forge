import { BRUSH_TOOLS, type BrushTool, type EraseTarget, type StrokeKind } from "./brushTools";
import { HeightSculpt, type HeightBrush, type HeightsOver } from "./heightBrush";
import { LANE_REACH, laneIndex, meshWithin, placedLanes, type LaneMode } from "../placement/lanes";
import { PlacementGround } from "../placement/ground";
import type { Placement } from "../placement/placement";
import { symmetricCopies } from "../placement/symmetricCopies";
import { SAMPLE_CAP, StrokeSampler } from "./sample";
import { sweptLanes, sweptSystems } from "./sweep";
import { copies, imagesOfStamps, type Symmetry } from "../geometry/symmetry";
import { MESH_BETA, meshPairs, type MeshPoint } from "../geometry/mesh";
import { PairSet, type Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import type { SegmentIndex, Segment } from "../geometry/segments";
import { seeded } from "../random";
import type { SpatialGrid } from "../spatialGrid";
import { counted } from "../text";
import type { HeightPreview } from "../height";
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
  /** What a height stroke does. */
  height: HeightBrush;
}

/**
 * What a stroke does so far. A paint stroke's new points carry provisional ids -1..-n in
 * `points` order, and its lanes may join them to existing systems by their real ids. A
 * connect stroke's pairs join systems it swept; `sparse` is true when the lane density is the
 * only reason it added none. A height stroke's heights are the shown heights it would give the
 * galaxy it began on, and `over` works them out again from the heights an edit finds.
 */
export type StrokeResult =
  | ({ kind: "paint" } & Placement)
  | { kind: "erase"; doomed: number[]; kept: number[] }
  | { kind: "cut"; lanes: Pair[] }
  | { kind: "connect"; swept: number[]; pairs: Pair[]; sparse: boolean }
  | { kind: "height"; heights: HeightPreview; over: HeightsOver };

/**
 * Where the map draws each system and a grid over those points: where an erase, connect or cut
 * stroke finds the systems and lanes it sweeps. New lanes are still laid between the systems'
 * own positions.
 */
export interface SweptGround {
  readonly systems: ReadonlyMap<number, SystemNode>;
  readonly grid: SpatialGrid;
}

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
  readonly placement: PlacementGround;
  private sweptLaneIndex: SegmentIndex<MeshPoint> | null = null;

  constructor(
    readonly settings: BrushSettings,
    readonly systems: ReadonlyMap<number, SystemNode>,
    readonly grid: SpatialGrid,
    readonly swept: SweptGround,
  ) {
    this.r = settings.size / 2;
    this.placement = new PlacementGround(systems, grid, settings.symmetry);
  }

  /** The stamps and every image of them. */
  images(stamps: readonly Pt[]): Pt[] {
    return imagesOfStamps(stamps, this.settings.symmetry).flat();
  }

  /** As `PlacementGround.lanesNear`, between where the map draws the lanes' ends. */
  sweptLanesNear(points: readonly Pt[], d: number): Array<Segment<MeshPoint>> {
    this.sweptLaneIndex ??= laneIndex(this.swept.systems);
    return this.sweptLaneIndex.near(points, d);
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
    const { laneMode: mode, beta, spacing, symmetry } = this.ground.settings;
    // The sampler keeps every image `spacing` from the rest, so none merges.
    const { points, imageOfNew } = symmetricCopies(base, symmetry);
    const pairs = placedLanes({
      points,
      base: base.length,
      mode,
      beta,
      spacing,
      ground: this.ground.placement,
      imageOfNew,
    });
    const result: StrokeResult = { kind: "paint", points, pairs };
    this.painted = { base: base.length, result };
    return result;
  }
}

class EraseStroke implements Strategy {
  private readonly doomed = new Set<number>();
  private readonly kept = new Set<number>();

  constructor(private readonly ground: StrokeGround) {}

  add(stamps: readonly Pt[]): void {
    const { r, swept: ground, settings } = this.ground;
    const swept = sweptSystems(this.ground.images(stamps), r, ground.grid, {
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
    const { r, swept } = this.ground;
    // Connecting adds lanes only, so it takes special systems too.
    const reached = sweptSystems(this.ground.images(stamps), r, swept.grid, {
      includeSpecials: true,
    });
    for (const id of reached.doomed) this.swept.add(id);
  }

  /** The mesh over the swept systems, less pairs already linked or kept apart; redone only when the sweep grows. */
  result(): StrokeResult {
    if (this.connected?.swept === this.swept.size) return this.connected.result;
    const ground = this.ground;
    const { systems, placement } = ground;
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
    const existing = placement.lanesNear(points, maxLength);
    const keep = (a: number, b: number) => !apart(a, b) && !apart(b, a);
    const meshed = meshWithin(points, { beta: ground.settings.beta, maxLength, existing, keep });
    const pairs = placement.symmetric
      ? placement.symmetricLanes(
          meshed,
          () => null,
          (id) => systems.get(id)!,
          existing,
          keep,
        )
      : meshed;
    // Nothing to add at the chosen density: true only when the densest mesh would add one, so an
    // already-linked or crossing pair still reads as a plain zero.
    const sparse =
      meshed.length === 0 &&
      points.length >= 2 &&
      meshWithin(points, { beta: MESH_BETA.dense, maxLength, existing, keep }).length > 0;
    const result: StrokeResult = { kind: "connect", swept, pairs, sparse };
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
    for (const [a, b] of sweptLanes(all, r, this.ground.sweptLanesNear(all, r))) {
      this.cut.add(a, b);
    }
  }

  result(): StrokeResult {
    return { kind: "cut", lanes: this.cut.sorted() };
  }
}

class HeightStroke implements Strategy {
  private readonly sculpt: HeightSculpt;

  constructor(private readonly ground: StrokeGround) {
    const { settings, r, systems, grid } = ground;
    this.sculpt = new HeightSculpt(settings.height, r, systems, grid);
  }

  add(stamps: readonly Pt[]): void {
    this.sculpt.add(this.ground.images(stamps));
  }

  result(): StrokeResult {
    const sculpt = this.sculpt;
    return {
      kind: "height",
      heights: sculpt.heights(),
      over: (systems) => sculpt.heights(systems),
    };
  }
}

const STRATEGIES: Record<StrokeKind, (ground: StrokeGround, seed: number) => Strategy> = {
  paint: (ground, seed) => new PaintStroke(ground, seed),
  erase: (ground) => new EraseStroke(ground),
  connect: (ground) => new ConnectStroke(ground),
  cut: (ground) => new CutStroke(ground),
  height: (ground) => new HeightStroke(ground),
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
    swept: SweptGround,
  ) {
    const ground = new StrokeGround(settings, systems, grid, swept);
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
      return result.sparse
        ? "+0 lanes · raise lane density"
        : `+${counted(result.pairs.length, "lane")}`;
    case "height":
      return `↕ ${counted(result.heights.size, "system")}`;
  }
}
