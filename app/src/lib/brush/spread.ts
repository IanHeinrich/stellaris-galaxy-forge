import type { SystemMove } from "../../generated/SystemMove";
import type { SystemNode } from "../../generated/SystemNode";
import type { MapExtent } from "../guides";
import type { MeshPoint } from "../geometry/mesh";
import { memberShift, orbitOf, type Orbit } from "../geometry/orbits";
import { pairKey } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";
import { SegmentIndex } from "../geometry/segments";
import type { Symmetry } from "../geometry/symmetry";
import { LEAST_SPACING } from "../placement/limits";
import { sharedLaneIndex } from "../placement/lanes";
import { SpatialGrid } from "../spatialGrid";
import { taper } from "./heightBrush";
import { hasSpecialRole } from "./special";

/** One spread stroke's settings, and the bounds of the document it moves systems in. */
export interface SpreadBrush {
  /** How far one pass moves a system at the centre, 0 to 1. */
  strength: number;
  /** Whether special and home systems move too. */
  specials: boolean;
  /** Alt: Gather pulls the systems under the brush towards its centre instead. */
  gather: boolean;
  /** The map's edge, which no move takes a system further past; null when the document records none. */
  edge: MapExtent | null;
  /** The distance no move brings two systems closer than. */
  gap: number;
  /**
   * Systems that stay put with those of a special role: the empires' homes and the special
   * systems the game data finds.
   */
  kept: ReadonlySet<number>;
}

/** The moves a spread stroke makes, worked out again over the galaxy an edit finds. */
export type MovesOver = (
  systems: ReadonlyMap<number, SystemNode>,
  grid: SpatialGrid,
) => SystemMove[];

/** The share of a too-close pair's overlap one frame's pass at full strength takes away. */
const SPREAD_RATE = 0.5;
/** The share of the way to the brush centre one frame's pass at full strength moves a system. */
const GATHER_RATE = 0.05;
/** How many times a blocked move is halved before the system stays put for the pass. */
const CUTS = 4;
/** Packing density of a hexagonal lattice: the area per point is this times the spacing squared. */
const HEX_AREA = Math.sqrt(3) / 2;

/** Where each system stands as a stroke moves them: the galaxy's grid for the rest, and one of its own for the moved. */
class Positions {
  private readonly moved = new SpatialGrid();
  private readonly nodes = new Map<number, SystemNode>();

  constructor(
    private readonly systems: ReadonlyMap<number, SystemNode>,
    private readonly grid: SpatialGrid,
  ) {}

  at(id: number): Pt {
    return this.nodes.get(id) ?? this.systems.get(id)!;
  }

  isMoved(id: number): boolean {
    return this.nodes.has(id);
  }

  movedIds(): number[] {
    return [...this.nodes.keys()];
  }

  move(id: number, to: Pt): void {
    const node = this.nodes.get(id) ?? { ...this.systems.get(id)! };
    node.x = to.x;
    node.y = to.y;
    this.nodes.set(id, node);
    this.moved.update(node);
  }

  /** Calls `fn` with every system within `r` of `c`, edge included, and its distance. */
  within(c: Pt, r: number, fn: (id: number, p: Pt, d: number) => void): void {
    const visit = (s: SystemNode) => fn(s.id, s, Math.hypot(s.x - c.x, s.y - c.y));
    this.grid.forEachWithin(c.x, c.y, r, (s) => {
      if (!this.nodes.has(s.id)) visit(s);
    });
    this.moved.forEachWithin(c.x, c.y, r, visit);
  }
}

/**
 * Every lane, where it runs as a stroke moves its ends: the galaxy's shared index for lanes
 * whose ends have not moved, and one of its own for the lanes of moved systems.
 */
class Lanes {
  private readonly relaid = new SegmentIndex<MeshPoint>();
  private readonly handles = new Map<string, number>();
  private readonly still: SegmentIndex<MeshPoint>;

  constructor(
    private readonly systems: ReadonlyMap<number, SystemNode>,
    private readonly points: Positions,
  ) {
    this.still = sharedLaneIndex(systems);
  }

  /** The systems `id` has lanes to. */
  ends(id: number): number[] {
    return (this.systems.get(id)?.lanes ?? []).flatMap((l) =>
      this.systems.has(l.to) ? [l.to] : [],
    );
  }

  /** Lays the lanes of `id` where it stands now. */
  moved(id: number): void {
    const a = { id, ...this.points.at(id) };
    for (const to of this.ends(id)) {
      const key = pairKey(id, to);
      const old = this.handles.get(key);
      if (old !== undefined) this.relaid.remove(old);
      this.handles.set(key, this.relaid.add(a, { id: to, ...this.points.at(to) }));
    }
  }

  /** The keys of the lanes crossing ab that touch neither `ida` nor `idb`. */
  crossing(a: Pt, b: Pt, ida: number, idb: number): string[] {
    const away = (s: { a: MeshPoint; b: MeshPoint }) =>
      s.a.id !== ida && s.a.id !== idb && s.b.id !== ida && s.b.id !== idb;
    const keys: string[] = [];
    for (const s of this.still.crossing(a, b)) {
      if (away(s) && !this.points.isMoved(s.a.id) && !this.points.isMoved(s.b.id)) {
        keys.push(pairKey(s.a.id, s.b.id));
      }
    }
    for (const s of this.relaid.crossing(a, b)) {
      if (away(s)) keys.push(pairKey(s.a.id, s.b.id));
    }
    return keys;
  }
}

/** How far `p` lies past `edge`; zero or less inside it. */
function pastEdge(edge: MapExtent, p: Pt): number {
  return edge.shape === "circle"
    ? Math.hypot(p.x, p.y) - edge.radius
    : Math.max(Math.abs(p.x), Math.abs(p.y)) - edge.half;
}

/** A direction away from a system standing exactly on another, the same for the same pair. */
function apart(a: number, b: number): Pt {
  const angle = (a * 2.399963 + b) % (2 * Math.PI);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** One spread stroke's passes laid over one galaxy. */
class SpreadRun {
  private readonly points: Positions;
  private readonly lanes: Lanes;
  private readonly orbits = new Map<number, Orbit | null>();
  private readonly taken = new Set<number>();
  private readonly gap: number;
  /** The spacing a spread evens out to, found at its first stamp over two or more systems. */
  private spacing: number | null = null;

  constructor(
    private readonly brush: SpreadBrush,
    private readonly r: number,
    private readonly systems: ReadonlyMap<number, SystemNode>,
    private readonly grid: SpatialGrid,
    private readonly symmetry: Symmetry,
  ) {
    this.points = new Positions(systems, grid);
    this.lanes = new Lanes(systems, this.points);
    // Gather stops where the paint brush would, so systems never pile onto one point.
    this.gap = Math.max(brush.gap, LEAST_SPACING);
  }

  /** One pass at `centres`, a stamp and its images, standing for `amount` frames. */
  pass(centres: readonly Pt[], amount: number): void {
    const pushes = new Map<number, Pt>();
    for (const c of centres) {
      if (!this.brush.gather) this.spacing ??= this.fillSpacing(c);
      this.points.within(c, this.r, (id, p, d) => {
        if (pushes.has(id)) return;
        const w = taper(d, this.r) * this.brush.strength * amount;
        if (w > 0) pushes.set(id, this.push(id, p, c, w));
      });
    }
    for (const id of [...pushes.keys()].sort((a, b) => a - b)) {
      const orbit = this.orbitOf(id);
      if (orbit === null || orbit.lead.id !== id) continue;
      const d = pushes.get(id)!;
      if (d.x !== 0 || d.y !== 0) this.moveOrbit(orbit, d);
    }
  }

  moves(): SystemMove[] {
    return this.points
      .movedIds()
      .sort((a, b) => a - b)
      .flatMap((id) => {
        const p = this.points.at(id);
        const s = this.systems.get(id)!;
        return p.x === s.x && p.y === s.y ? [] : [{ system: id, x: p.x, y: p.y }];
      });
  }

  /**
   * The spacing the systems within the brush at `c` would have spread evenly over it: the
   * average spacing under the brush, which a lone clump spreads out to fill; null under two.
   */
  private fillSpacing(c: Pt): number | null {
    let n = 0;
    this.points.within(c, this.r, () => n++);
    return n >= 2 ? Math.sqrt((Math.PI * this.r * this.r) / (HEX_AREA * n)) : null;
  }

  /** How far one pass at weight `w` would move system `id` at `p`, under a brush centred on `c`. */
  private push(id: number, p: Pt, c: Pt, w: number): Pt {
    if (this.brush.gather) {
      const f = Math.min(1, w * GATHER_RATE);
      return { x: (c.x - p.x) * f, y: (c.y - p.y) * f };
    }
    const spacing = this.spacing;
    if (spacing === null) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    this.points.within(p, spacing, (other, q, d) => {
      if (other === id) return;
      const u = d > 0 ? { x: (p.x - q.x) / d, y: (p.y - q.y) / d } : apart(id, other);
      const overlap = (spacing - d) / 2;
      x += u.x * overlap;
      y += u.y * overlap;
    });
    const f = Math.min(1, w * SPREAD_RATE);
    x *= f;
    y *= f;
    const most = spacing / 2;
    const length = Math.hypot(x, y);
    if (length > most) {
      x *= most / length;
      y *= most / length;
    }
    return { x, y };
  }

  /** The orbit `id` leads or belongs to, found the first time it is pushed; null when it stays put. */
  private orbitOf(id: number): Orbit | null {
    if (this.orbits.has(id)) return this.orbits.get(id)!;
    const orbit = orbitOf(id, this.systems, this.grid, this.symmetry, this.taken);
    const kept = orbit && orbit.members.some((m) => this.staysPut(m.id)) ? null : orbit;
    for (const m of orbit?.members ?? [{ id }]) this.orbits.set(m.id, kept);
    return kept;
  }

  private staysPut(id: number): boolean {
    if (this.brush.specials) return false;
    const s = this.systems.get(id)!;
    return hasSpecialRole(s) || this.brush.kept.has(id);
  }

  /** Moves every member of `orbit` by its share of `d`, or by a half, a quarter… of it where that is blocked. */
  private moveOrbit(orbit: Orbit, d: Pt): void {
    let t = 1;
    for (let cut = 0; cut <= CUTS; cut++, t /= 2) {
      if (this.tryOrbit(orbit, { x: d.x * t, y: d.y * t })) return;
    }
  }

  private tryOrbit(orbit: Orbit, d: Pt): boolean {
    const done: Array<[number, Pt]> = [];
    for (const m of orbit.members) {
      const from = this.points.at(m.id);
      const e = memberShift(orbit, d, this.symmetry, m.k);
      if (e.x === 0 && e.y === 0) continue;
      const to = { x: from.x + e.x, y: from.y + e.y };
      if (!this.allowed(m.id, from, to)) {
        for (const [id, back] of done.reverse()) this.place(id, back);
        return false;
      }
      done.push([m.id, { x: from.x, y: from.y }]);
      this.place(m.id, to);
    }
    return true;
  }

  private place(id: number, to: Pt): void {
    this.points.move(id, to);
    this.lanes.moved(id);
  }

  /** Whether system `id` may go from `from` to `to`. */
  private allowed(id: number, from: Pt, to: Pt): boolean {
    const edge = this.brush.edge;
    // A system already past the edge may still move, so long as it goes no further out.
    if (edge && pastEdge(edge, to) > Math.max(0, pastEdge(edge, from))) return false;
    let close = false;
    this.points.within(to, this.gap, (other, q, d) => {
      if (close || other === id || d >= this.gap) return;
      close = d < Math.hypot(from.x - q.x, from.y - q.y);
    });
    if (close) return false;
    for (const end of this.lanes.ends(id)) {
      const at = this.points.at(end);
      const after = this.lanes.crossing(to, at, id, end);
      if (after.length === 0) continue;
      const before = new Set(this.lanes.crossing(from, at, id, end));
      if (after.some((key) => !before.has(key))) return false;
    }
    return true;
  }
}

/**
 * What a spread stroke has done so far to a galaxy fixed at its start. Each pass moves the
 * systems under one stamp and its images towards even spacing, or towards the stamp's centre
 * when gathering. A system's orbit under the symmetry moves with it, and a move that would
 * cross a lane, go further past the map's edge or close on another system inside the gap is cut
 * short. The passes are kept, so `over` lays them again over the galaxy an edit finds.
 */
export class SpreadSculpt {
  private readonly passes: Array<{ centres: readonly Pt[]; amount: number }> = [];
  private readonly run: SpreadRun;

  constructor(
    private readonly brush: SpreadBrush,
    private readonly r: number,
    private readonly systems: ReadonlyMap<number, SystemNode>,
    grid: SpatialGrid,
    private readonly symmetry: Symmetry,
  ) {
    this.run = new SpreadRun(brush, r, systems, grid, symmetry);
  }

  /** One pass at `centres`, a stamp and its images, standing for `amount` frames. */
  add(centres: readonly Pt[], amount: number): void {
    this.passes.push({ centres, amount });
    this.run.pass(centres, amount);
  }

  /** Every system the stroke has moved, where it stands now, by id. */
  moves(): SystemMove[] {
    return this.run.moves();
  }

  /** The stroke's passes laid over `systems`; the moves so far when they are the galaxy it began on. */
  readonly over: MovesOver = (systems, grid) => {
    if (systems === this.systems) return this.run.moves();
    const run = new SpreadRun(this.brush, this.r, systems, grid, this.symmetry);
    for (const { centres, amount } of this.passes) run.pass(centres, amount);
    return run.moves();
  };
}
