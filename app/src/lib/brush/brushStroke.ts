import { laneSegments, strokeLanes, withProvisionalIds, type LaneMode, type Pair } from "./lanes";
import { seeded } from "./random";
import { StrokeSampler } from "./sample";
import { sweptLanes, sweptSystems } from "./sweep";
import { imagesOfStamps, symmetricPairs, symmetricPoints, type Symmetry } from "./symmetry";
import { SegmentIndex } from "../geometry/joinIslands";
import type { MeshPoint } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import type { SpatialGrid } from "../spatialGrid";
import { counted } from "../text";
import type { SystemNode } from "../../generated/SystemNode";

export type BrushTool = "paint" | "erase";

export interface BrushSettings {
  tool: BrushTool;
  /** Brush diameter, in world units. */
  size: number;
  spacing: number;
  laneMode: LaneMode;
  eraseTarget: "systems" | "lanes";
  eraseSpecials: boolean;
  symmetry: Symmetry;
  /** The β of the lanes a paint stroke adds. */
  beta: number;
}

/**
 * What a stroke does so far. A paint stroke's new points carry provisional ids -1..-n in
 * `points` order, and its lanes may join them to existing systems by their real ids.
 */
export type StrokeResult =
  | { kind: "paint"; points: Pt[]; pairs: Pair[] }
  | { kind: "erase"; doomed: number[]; kept: number[] }
  | { kind: "cut"; lanes: Pair[] };

/** A new lane is at most this many spacings long. */
const LANE_REACH = 3;

function ordered(a: number, b: number): Pair {
  return a < b ? [a, b] : [b, a];
}

const provisional = (index: number) => -(index + 1);
const indexOf = (id: number) => -id - 1;

/**
 * One stroke of the paint or erase brush over a galaxy fixed at its start. Stamps arrive as the
 * pointer moves; what they do depends only on the settings, the seed and the stamp sequence,
 * so the preview drawn from `result` is exactly what the release commits.
 */
export class BrushStroke {
  readonly r: number;
  private readonly sampler: StrokeSampler | null;
  private readonly blockers: Pt[];
  private readonly doomed = new Set<number>();
  private readonly kept = new Set<number>();
  private readonly cut = new Map<string, Pair>();
  private segments: Array<[MeshPoint, MeshPoint]> | null = null;
  private painted: { base: number; result: StrokeResult } | null = null;

  constructor(
    private readonly settings: BrushSettings,
    private readonly systems: ReadonlyMap<number, SystemNode>,
    private readonly grid: SpatialGrid,
    seed: number,
  ) {
    this.r = settings.size / 2;
    this.blockers = [...systems.values()].map(({ x, y }) => ({ x, y }));
    this.sampler =
      settings.tool === "paint"
        ? new StrokeSampler({
            r: this.r,
            spacing: settings.spacing,
            blockers: this.blockers,
            rand: seeded(seed),
          })
        : null;
  }

  add(stamps: readonly Pt[]): void {
    if (this.sampler) {
      this.sampler.add(stamps);
      return;
    }
    const all = imagesOfStamps(stamps, this.settings.symmetry).flat();
    if (this.settings.eraseTarget === "lanes") {
      for (const pair of sweptLanes(all, this.r, this.allSegments())) {
        this.cut.set(`${pair[0]},${pair[1]}`, pair);
      }
      return;
    }
    const swept = sweptSystems(all, this.r, this.grid, {
      includeSpecials: this.settings.eraseSpecials,
    });
    for (const id of swept.doomed) this.doomed.add(id);
    for (const id of swept.kept) this.kept.add(id);
  }

  /** What the stroke does so far; a paint stroke re-meshes only when it has placed new points. */
  result(): StrokeResult {
    if (this.sampler) return this.paint(this.sampler);
    if (this.settings.eraseTarget === "lanes") {
      return {
        kind: "cut",
        lanes: [...this.cut.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]),
      };
    }
    const sorted = (ids: Set<number>) => [...ids].sort((a, b) => a - b);
    return { kind: "erase", doomed: sorted(this.doomed), kept: sorted(this.kept) };
  }

  private paint(sampler: StrokeSampler): StrokeResult {
    const base = sampler.points;
    if (this.painted?.base === base.length) return this.painted.result;
    const { symmetry, spacing } = this.settings;
    const copies =
      symmetry.kind === "off"
        ? { base: base.map(({ x, y }) => ({ x, y })), points: base.map(({ x, y }) => ({ x, y })) }
        : symmetricPoints(base, symmetry, spacing, this.blockers);
    const result: StrokeResult = {
      kind: "paint",
      points: copies.points,
      pairs: this.lanes(copies.base, copies.points),
    };
    this.painted = { base: base.length, result };
    return result;
  }

  private lanes(base: readonly Pt[], points: readonly Pt[]): Pair[] {
    const { laneMode: mode, beta, spacing, symmetry } = this.settings;
    if (mode === "off" || points.length === 0) return [];
    const maxLength = LANE_REACH * spacing;
    const existing = this.segmentsNear(points, maxLength);
    if (mode === "new" && symmetry.kind !== "off") {
      // Mesh one copy and repeat it, so the copies' lanes are as symmetric as their systems.
      const pairs = strokeLanes({
        added: withProvisionalIds(base),
        nearby: [],
        existing,
        beta,
        mode,
        maxLength,
      }).map(([a, b]): Pair => ordered(indexOf(a), indexOf(b)));
      const lanes = new SegmentIndex();
      for (const [a, b] of existing) lanes.add(a, b);
      return symmetricPairs(pairs, base.length, symmetry)
        .filter(([i, j]) => !lanes.crosses(points[i], points[j]))
        .map(([i, j]) => ordered(provisional(i), provisional(j)));
    }
    return strokeLanes({
      added: withProvisionalIds(points),
      nearby: mode === "nearby" ? this.systemsNear(points, maxLength) : [],
      existing,
      beta,
      mode,
      maxLength,
    }).map(([a, b]) => ordered(a, b));
  }

  private allSegments(): Array<[MeshPoint, MeshPoint]> {
    this.segments ??= laneSegments(this.systems.values());
    return this.segments;
  }

  /** The existing lanes whose bounding box comes within `d` of the points' bounding box. */
  private segmentsNear(points: readonly Pt[], d: number): Array<[MeshPoint, MeshPoint]> {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return this.allSegments().filter(
      ([a, b]) =>
        Math.max(a.x, b.x) >= x0 - d &&
        Math.min(a.x, b.x) <= x1 + d &&
        Math.max(a.y, b.y) >= y0 - d &&
        Math.min(a.y, b.y) <= y1 + d,
    );
  }

  /** The existing systems within `d` of some point. */
  private systemsNear(points: readonly Pt[], d: number): MeshPoint[] {
    const found = new Map<number, MeshPoint>();
    const d2 = d * d;
    for (const p of points) {
      this.grid.forEachIn(p.x - d, p.y - d, p.x + d, p.y + d, (s) => {
        if (!found.has(s.id) && (s.x - p.x) ** 2 + (s.y - p.y) ** 2 <= d2) {
          found.set(s.id, { id: s.id, x: s.x, y: s.y });
        }
      });
    }
    return [...found.values()];
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
  }
}
