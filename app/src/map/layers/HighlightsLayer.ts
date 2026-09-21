import { Container, Graphics } from "pixi.js";
import type { LaneRef } from "../../store/editorStore";
import type { Camera } from "../Camera";
import type { LaneTarget } from "../interaction/MapIntent";
import { MIDPOINT_HIT_PX, PORT_INNER, PORT_OUTER } from "../picking/zones";
import { portCapable as portsAt } from "../../lib/visual/labels";
import { ghostLaneSegments, type MoveGhost, type Pt } from "../moveGhosts";
import type { FeZonePreview } from "../feZonePreview";
import type { NebulaPreview } from "../nebulaPreview";
import { FE_DIRECTIONS, FE_ZONE_DISTANCES, FE_ZONE_RADIUS, feZoneCentre } from "../../lib/feZone";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { ORIGIN_ALPHA } from "../../lib/visual/style";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

const SELECTION = { color: 0xffd166, radius: 11, width: 2, alpha: 1 };
const HOVER = { color: 0xffffff, radius: 9, width: 1.5, alpha: 0.6 };
const GHOST = { color: 0xffd166, radius: 11, width: 2, alpha: 1 };
/** Systems using the initializer the browser is highlighting: muted, distinct from selection and hover. */
const MATCHED = { color: 0x7dd3fc, radius: 13, width: 2, alpha: 0.6 };
const TARGET_VALID = { color: 0x6ee7b7, radius: 13, width: 2, alpha: 0.9 };
/** Systems a nebula drag would take in, and those it would let go. */
const JOINING = { color: 0x6ee7b7, radius: 15, width: 2, alpha: 0.85 };
const LEAVING = { color: 0xfbbf24, radius: 15, width: 2, alpha: 0.85 };
const TARGET_INVALID = { color: 0xf87171, radius: 13, width: 2, alpha: 0.9 };
const PORT_RING = { color: 0x6ee7b7, alpha: 0.45, hotAlpha: 1, width: 1.5, dashes: 16 };
const GHOST_LANE = { color: 0xffd166, alpha: 0.9 };
const RUBBER_LANE = { color: 0x6ee7b7, alpha: 0.9 };
const HOVER_LANE = { color: 0xffffff, alpha: 0.5, widthPx: 3 };
const SELECTED_LANE = { color: 0xffd166, alpha: 0.9, widthPx: 4 };
const MIDPOINT = { fill: 0x1c2333, stroke: 0xffffff, arm: 3.5 };
const MARQUEE = { color: 0xffd166, strokeAlpha: 0.9, fillAlpha: 0.08 };
/** The dashed ring a nebula drag proposes, until the pointer comes up. */
const GHOST_RING = { color: 0xc4b5fd, alpha: 0.9 };
const GHOST_RING_DASHES = 48;
/** The dashed ring a zone drag proposes: the zones' own hue, or the refusal's where it cannot go. */
const GHOST_ZONE = { color: 0xf0abfc, alpha: 0.9 };
const GHOST_ZONE_BLOCKED = { color: 0xf87171, alpha: 0.9 };
/** The grid a zone drag chooses from, under the ghost ring: faint rays and one dot per slot. */
const FE_GRID_RAY = { color: GHOST_ZONE.color, alpha: 0.15 };
const FE_GRID_RAY_LENGTH = FE_ZONE_DISTANCES[FE_ZONE_DISTANCES.length - 1];
const FE_GRID_DOT = { color: GHOST_ZONE.color, alpha: 0.35, radiusPx: 2.5 };
const FE_GRID_DOT_BLOCKED = { color: GHOST_ZONE_BLOCKED.color, alpha: 0.35, radiusPx: 2.5 };
const FE_GRID_SNAPPED_RADIUS_PX = 4.5;
const ORIGIN_MARK = { color: 0xffffff, alpha: 0.3, armPx: 7 };
/** "Keep stars outside": the galaxy's core radius, as thin and faint as the origin mark. */
const CORE_RING = { color: ORIGIN_MARK.color, alpha: ORIGIN_MARK.alpha };

export interface RubberLane {
  from: number[];
  x: number;
  y: number;
  target: LaneTarget | null;
}

/** A world-space rectangle with `x0 <= x1` and `y0 <= y1`. */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function ring(spec: typeof SELECTION): Graphics {
  const g = new Graphics();
  g.circle(0, 0, spec.radius).stroke({ color: spec.color, width: spec.width, alpha: spec.alpha });
  g.visible = false;
  return g;
}

/** A thin dashed ring in the middle of the port band; the hit zone is the whole band. */
function portRing(): Graphics {
  const g = new Graphics();
  const r = (PORT_INNER + PORT_OUTER) / 2;
  const step = (Math.PI * 2) / PORT_RING.dashes;
  for (let i = 0; i < PORT_RING.dashes; i++) {
    const start = i * step;
    g.moveTo(r * Math.cos(start), r * Math.sin(start)).arc(0, 0, r, start, start + step * 0.6);
  }
  g.stroke({ color: PORT_RING.color, width: PORT_RING.width });
  g.alpha = PORT_RING.alpha;
  g.visible = false;
  return g;
}

function dashedCircle(g: Graphics, x: number, y: number, r: number, dashes: number): void {
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    const start = i * step;
    g.moveTo(x + r * Math.cos(start), y + r * Math.sin(start)).arc(
      x,
      y,
      r,
      start,
      start + step * 0.6,
    );
  }
}

const GHOST_ZONE_DASHES = 32;

/** Where the line from `from` meets a ring of `radius` about `centre`. */
function ringEdge(from: Pt, centre: Pt, radius: number): Pt {
  const d = Math.hypot(centre.x - from.x, centre.y - from.y);
  if (d === 0) return centre;
  const t = Math.max(0, d - radius) / d;
  return { x: from.x + (centre.x - from.x) * t, y: from.y + (centre.y - from.y) * t };
}

/** The galaxy origin: a reference point for a document whose canvas may be empty. */
function originCross(): Graphics {
  const g = new Graphics();
  const a = ORIGIN_MARK.armPx;
  g.moveTo(-a, 0).lineTo(a, 0).moveTo(0, -a).lineTo(0, a);
  g.stroke({ color: ORIGIN_MARK.color, width: 1, alpha: ORIGIN_MARK.alpha });
  return g;
}

function midpointButton(): Graphics {
  const g = new Graphics();
  const a = MIDPOINT.arm;
  g.circle(0, 0, MIDPOINT_HIT_PX).fill({ color: MIDPOINT.fill, alpha: 0.85 });
  g.circle(0, 0, MIDPOINT_HIT_PX).stroke({ color: MIDPOINT.stroke, width: 1, alpha: 0.6 });
  g.moveTo(-a, -a).lineTo(a, a).moveTo(a, -a).lineTo(-a, a);
  g.stroke({ color: MIDPOINT.stroke, width: 1.5, alpha: 0.9 });
  g.visible = false;
  return g;
}

/** As many identical rings as are needed at once, created on demand and hidden when spare. */
class RingPool {
  private readonly rings: Graphics[] = [];
  private scale: Pt = { x: 1, y: 1 };

  constructor(
    private readonly parent: Container,
    private readonly spec: typeof SELECTION,
  ) {}

  /** Shows one ring per point, at `alpha(i)`, and hides the rest. */
  place(points: ReadonlyArray<Pt | undefined>, alpha: (i: number) => number = () => 1): void {
    while (this.rings.length < points.length) {
      const g = ring(this.spec);
      g.scale.set(this.scale.x, this.scale.y);
      this.rings.push(g);
      this.parent.addChild(g);
    }
    this.rings.forEach((g, i) => {
      const at = points[i];
      g.visible = at !== undefined;
      if (at) {
        g.position.set(at.x, at.y);
        g.alpha = alpha(i);
      }
    });
  }

  setScale(scale: Pt): void {
    this.scale = scale;
    for (const g of this.rings) g.scale.set(scale.x, scale.y);
  }
}

/**
 * Screen-sized rings around systems (selection, hover, port band, snap target, move ghosts)
 * plus the previews of an interaction in progress: the ghosts' lanes, the rubber lines of a
 * pending lane, the lanes a mesh action would add, the marquee, and the hovered and selected
 * lanes with the hovered lane's "×". It also marks the galaxy origin and, where the galaxy
 * sets one, the core radius stars are meant to stay outside of.
 */
export class HighlightsLayer implements MapLayer {
  readonly id = "highlights" as const;
  readonly container = new Container();
  private readonly hover = ring(HOVER);
  private readonly port = portRing();
  private readonly targetValid = ring(TARGET_VALID);
  private readonly targetInvalid = ring(TARGET_INVALID);
  private readonly selectionRings: RingPool;
  private readonly ghostRings: RingPool;
  private readonly joiningRings: RingPool;
  private readonly leavingRings: RingPool;
  private readonly matchedRings: RingPool;
  private readonly midpoint = midpointButton();
  private readonly previewLines = new Graphics();
  private readonly laneLines = new Graphics();
  private readonly marqueeBox = new Graphics();
  private readonly feZoneGrid = new Graphics();
  private readonly ghostRing = new Graphics();
  private readonly origin = originCross();
  private readonly coreRing = new Graphics();
  private coreRadius = EMPTY_CONTEXT.coreRadius;
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private selection: number[] = [];
  private hoverId: number | null = null;
  private matched: ReadonlySet<number> = new Set();
  private ghosts: readonly MoveGhost[] = [];
  private dragged: ReadonlyMap<number, MoveGhost> = new Map();
  private rubber: RubberLane | null = null;
  private lanePreview: Array<[number, number]> | null = null;
  private marquee: WorldRect | null = null;
  private nebula: NebulaPreview | null = null;
  private feZone: FeZonePreview | null = null;
  private hoverLane: LaneRef | null = null;
  private selectedLane: LaneRef | null = null;
  private camScale = 1;
  private portCapable = false;
  private readonly scale = { x: 1, y: 1 };
  private readonly pixelScale = { x: 1, y: 1 };

  constructor() {
    this.container.addChild(
      this.coreRing,
      this.origin,
      this.laneLines,
      this.previewLines,
      this.marqueeBox,
      this.feZoneGrid,
      this.ghostRing,
      this.port,
      this.hover,
      this.targetValid,
      this.targetInvalid,
    );
    this.selectionRings = new RingPool(this.container, SELECTION);
    this.ghostRings = new RingPool(this.container, GHOST);
    this.matchedRings = new RingPool(this.container, MATCHED);
    this.joiningRings = new RingPool(this.container, JOINING);
    this.leavingRings = new RingPool(this.container, LEAVING);
    this.container.addChild(this.midpoint);
  }

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (ctx.coreRadius !== this.coreRadius) {
      this.coreRadius = ctx.coreRadius;
      this.drawCoreRing();
    }
    if (!loaded) return;
    this.placeAll();
    this.drawPreviews();
    this.drawLanes();
  }

  applyDelta(): void {
    this.placeAll();
    this.drawPreviews();
    this.drawLanes();
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const g of [this.hover, this.port, this.targetValid, this.targetInvalid]) {
      g.scale.set(this.scale.x, this.scale.y);
    }
    this.selectionRings.setScale(this.scale);
    this.ghostRings.setScale(this.scale);
    this.matchedRings.setScale(this.scale);
    this.joiningRings.setScale(this.scale);
    this.leavingRings.setScale(this.scale);
    cam.childScale(1, this.pixelScale);
    this.midpoint.scale.set(this.pixelScale.x, this.pixelScale.y);
    this.origin.scale.set(this.pixelScale.x, this.pixelScale.y);
    const portCapable = portsAt(cam.scale);
    if (cam.scale !== this.camScale || portCapable !== this.portCapable) {
      this.camScale = cam.scale;
      this.portCapable = portCapable;
      this.placeAll();
      this.drawLanes();
      this.drawFeZoneGrid();
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  setSelection(ids: number[]): void {
    this.selection = ids;
    this.placeAll();
  }

  setHover(id: number | null): void {
    this.hoverId = id;
    this.placeAll();
  }

  setPortHot(hot: boolean): void {
    this.port.alpha = hot ? PORT_RING.hotAlpha : PORT_RING.alpha;
  }

  setDragState(drag: DragState | null): void {
    this.ghosts = drag?.ghosts ?? [];
    this.dragged = drag?.byId ?? new Map();
    this.placeAll();
    this.drawPreviews();
  }

  setRubberLane(rubber: RubberLane | null): void {
    this.rubber = rubber;
    this.placeAll();
    this.drawPreviews();
  }

  setLanePreview(pairs: Array<[number, number]> | null): void {
    this.lanePreview = pairs;
    this.drawPreviews();
  }

  setMatched(ids: ReadonlySet<number>): void {
    this.matched = ids;
    this.placeAll();
  }

  /** The ghost ring a nebula drag is proposing, with the systems it would gain and lose. */
  setNebulaPreview(preview: NebulaPreview | null): void {
    this.nebula = preview;
    this.placeAll();
    this.drawGhostRing();
  }

  /** The ring a zone drag is proposing, with the system it would cover ringed as leaving. */
  setFeZonePreview(preview: FeZonePreview | null): void {
    this.feZone = preview;
    this.placeAll();
    this.drawGhostRing();
    this.drawFeZoneGrid();
  }

  setMarquee(rect: WorldRect | null): void {
    this.marquee = rect;
    this.drawMarquee();
  }

  setHoverLane(lane: LaneRef | null): void {
    if (sameLane(this.hoverLane, lane)) return;
    this.hoverLane = lane;
    this.drawLanes();
  }

  setSelectedLane(lane: LaneRef | null): void {
    if (sameLane(this.selectedLane, lane)) return;
    this.selectedLane = lane;
    this.drawLanes();
  }

  private placeAll(): void {
    const target = this.rubber?.target ?? null;
    this.selectionRings.place(
      this.selection.map((id) => this.systems.get(id)),
      (i) => (this.dragged.has(this.selection[i]) ? ORIGIN_ALPHA : 1),
    );
    const hoverId =
      this.hoverId !== null && this.selection.includes(this.hoverId) ? null : this.hoverId;
    this.place(this.hover, hoverId);
    const portId =
      this.portCapable && !this.rubber && this.ghosts.length === 0 ? this.hoverId : null;
    this.place(this.port, portId);
    this.place(this.targetValid, target?.valid ? target.id : null);
    this.place(this.targetInvalid, target && !target.valid ? target.id : null);
    this.ghostRings.place(this.ghosts);
    this.matchedRings.place([...this.matched].map((id) => this.systems.get(id)));
    this.joiningRings.place((this.nebula?.joining ?? []).map((id) => this.systems.get(id)));
    const covered = this.feZone?.blocked;
    this.leavingRings.place([
      ...(this.nebula?.leaving ?? []).map((id) => this.systems.get(id)),
      ...(covered ? [covered] : []),
    ]);
  }

  private place(g: Graphics, id: number | null): void {
    this.placeAt(g, id === null ? undefined : this.systems.get(id));
  }

  private placeAt(g: Graphics, at: Pt | null | undefined): void {
    if (!at) {
      g.visible = false;
      return;
    }
    g.position.set(at.x, at.y);
    g.visible = true;
  }

  private drawPreviews(): void {
    const g = this.previewLines;
    g.clear();
    const segments = ghostLaneSegments(this.systems, this.ghosts);
    for (const [a, b] of this.lanePreview ?? []) {
      const from = this.systems.get(a);
      const to = this.systems.get(b);
      if (from && to) segments.push([from, to]);
    }
    for (const [a, b] of segments) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (segments.length > 0) g.stroke({ ...GHOST_LANE, pixelLine: true });
    if (this.rubber) {
      const target = this.rubber.target && this.systems.get(this.rubber.target.id);
      const end = target ?? this.rubber;
      let any = false;
      for (const id of this.rubber.from) {
        const from = this.systems.get(id);
        if (!from) continue;
        g.moveTo(from.x, from.y).lineTo(end.x, end.y);
        any = true;
      }
      if (any) g.stroke({ ...RUBBER_LANE, pixelLine: true });
    }
  }

  private drawGhostRing(): void {
    const g = this.ghostRing;
    g.clear();
    const n = this.nebula;
    if (n && n.radius > 0) {
      dashedCircle(g, n.x, n.y, n.radius, GHOST_RING_DASHES);
      g.stroke({ ...GHOST_RING, pixelLine: true });
    }
    const z = this.feZone;
    if (!z) return;
    const style = z.blocked || z.offMap ? GHOST_ZONE_BLOCKED : GHOST_ZONE;
    dashedCircle(g, z.x, z.y, FE_ZONE_RADIUS, GHOST_ZONE_DASHES);
    const edge = ringEdge(z.anchor, z, FE_ZONE_RADIUS);
    g.moveTo(z.anchor.x, z.anchor.y).lineTo(edge.x, edge.y);
    g.stroke({ ...style, pixelLine: true });
  }

  /**
   * The grid a zone drag chooses from, under the ghost ring: eight faint rays to distance 200,
   * a faint dot at every clear slot, a faint hollow circle at every blocked one, and the snapped
   * slot as a brighter, slightly larger dot. Dot radii stay constant in screen pixels.
   */
  private drawFeZoneGrid(): void {
    const g = this.feZoneGrid;
    g.clear();
    const z = this.feZone;
    if (!z) return;
    for (const { key: direction } of FE_DIRECTIONS) {
      const tip = feZoneCentre(z.anchor, { direction, distance: FE_GRID_RAY_LENGTH });
      g.moveTo(z.anchor.x, z.anchor.y).lineTo(tip.x, tip.y);
    }
    g.stroke({ ...FE_GRID_RAY, pixelLine: true });
    const dotRadius = FE_GRID_DOT.radiusPx / this.camScale;
    for (const slot of z.slots) {
      if (slot.direction === z.direction && slot.distance === z.distance) continue;
      if (slot.clear) {
        g.circle(slot.x, slot.y, dotRadius).fill({
          color: FE_GRID_DOT.color,
          alpha: FE_GRID_DOT.alpha,
        });
      } else {
        g.circle(slot.x, slot.y, dotRadius).stroke({
          color: FE_GRID_DOT_BLOCKED.color,
          alpha: FE_GRID_DOT_BLOCKED.alpha,
          pixelLine: true,
        });
      }
    }
    const snappedStyle = z.blocked || z.offMap ? GHOST_ZONE_BLOCKED : GHOST_ZONE;
    g.circle(z.x, z.y, FE_GRID_SNAPPED_RADIUS_PX / this.camScale).fill({
      color: snappedStyle.color,
      alpha: snappedStyle.alpha,
    });
  }

  /** A world-space circle of the core radius, stroked one screen pixel wide at any zoom. */
  private drawCoreRing(): void {
    const g = this.coreRing;
    g.clear();
    if (this.coreRadius <= 0) return;
    g.circle(0, 0, this.coreRadius).stroke({ ...CORE_RING, pixelLine: true });
  }

  private drawMarquee(): void {
    const g = this.marqueeBox;
    g.clear();
    const r = this.marquee;
    if (!r) return;
    g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
      .fill({ color: MARQUEE.color, alpha: MARQUEE.fillAlpha })
      .stroke({ color: MARQUEE.color, alpha: MARQUEE.strokeAlpha, pixelLine: true });
  }

  private drawLanes(): void {
    const g = this.laneLines;
    g.clear();
    this.midpoint.visible = false;
    const selected = this.endpoints(this.selectedLane);
    if (selected) {
      g.moveTo(selected.a.x, selected.a.y)
        .lineTo(selected.b.x, selected.b.y)
        .stroke({
          color: SELECTED_LANE.color,
          alpha: SELECTED_LANE.alpha,
          width: SELECTED_LANE.widthPx / this.camScale,
        });
    }
    const hovered = this.endpoints(this.hoverLane);
    if (hovered && !sameLane(this.hoverLane, this.selectedLane)) {
      g.moveTo(hovered.a.x, hovered.a.y)
        .lineTo(hovered.b.x, hovered.b.y)
        .stroke({
          color: HOVER_LANE.color,
          alpha: HOVER_LANE.alpha,
          width: HOVER_LANE.widthPx / this.camScale,
        });
    }
    if (hovered) {
      this.placeAt(this.midpoint, {
        x: (hovered.a.x + hovered.b.x) / 2,
        y: (hovered.a.y + hovered.b.y) / 2,
      });
    }
  }

  private endpoints(lane: LaneRef | null) {
    if (!lane) return null;
    const a = this.systems.get(lane.a);
    const b = this.systems.get(lane.b);
    if (!a || !b || !a.lanes.some((l) => l.to === b.id)) return null;
    return { a, b };
  }
}

function sameLane(p: LaneRef | null, q: LaneRef | null): boolean {
  return p === q || (p !== null && q !== null && p.a === q.a && p.b === q.b);
}
