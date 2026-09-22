import { Container, Graphics } from "pixi.js";
import type { LaneRef } from "../../store/editorStore";
import type { Camera } from "../Camera";
import type { LaneSource, LaneTarget } from "../interaction/MapIntent";
import { edgeEnds, sameEdge, sameLane, type MapEdge } from "../picking/edges";
import { MIDPOINT_HIT_PX, PORT_INNER, PORT_OUTER, ringPortOffsetPx } from "../picking/zones";
import { portCapable as portsAt } from "../../lib/visual/labels";
import type { Pt } from "../../lib/geometry/pt";
import { ghostLaneSegments, type MoveGhost } from "../moveGhosts";
import type { FeZonePreview } from "../feZonePreview";
import type { NebulaPreview } from "../nebulaPreview";
import { toRing, type Segment } from "../../lib/feLinks";
import { FE_DIRECTIONS, FE_ZONE_DISTANCES, FE_ZONE_RADIUS, feZoneCentre } from "../../lib/feZone";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { ORIGIN_ALPHA } from "../../lib/visual/style";
import type { Segment as BrushSegment } from "../../lib/brush/lanes";
import type { BrushTool } from "../../lib/brush/brushStroke";
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
/** How far outside a targeted zone's ring its target ring is drawn, in screen pixels. */
const FE_ZONE_TARGET_MARGIN_PX = 14;
const PORT_RING = { color: 0x6ee7b7, alpha: 0.45, hotAlpha: 1, width: 1.5, dashes: 16 };
/** A zone's port ring is longer than a star's, so it takes more dashes to read the same. */
const FE_ZONE_PORT_DASHES = 48;
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
/** The brush circle and what a stroke would do: paint in the accent, erase in the refusal red. */
const BRUSH_PAINT = 0xffd166;
const BRUSH_ERASE = 0xf87171;
const BRUSH_KEPT = 0xfbbf24;
const BRUSH_DASHES = 48;
const BRUSH_DOT_PX = 3;
const BRUSH_RING_PX = 7;
const BRUSH_CUT_PX = 3;

export interface RubberLane {
  from: LaneSource;
  x: number;
  y: number;
  target: LaneTarget | null;
}

/** The brush circle at the pointer, `r` its world radius. */
export interface BrushCursor {
  tool: BrushTool;
  x: number;
  y: number;
  r: number;
}

/** What a held stroke would do, in world positions. */
export interface BrushPreview {
  /** New systems and the lanes to them. */
  points: readonly Pt[];
  lanes: readonly BrushSegment[];
  /** Systems an erase stroke removes, and the special ones it spares. */
  doomed: readonly Pt[];
  kept: readonly Pt[];
  /** Lanes an erase stroke cuts. */
  cut: readonly BrushSegment[];
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

/** The galaxy origin: a reference point for a document whose canvas may be empty. */
function originCross(): Graphics {
  const g = new Graphics();
  const a = ORIGIN_MARK.armPx;
  g.moveTo(-a, 0).lineTo(a, 0).moveTo(0, -a).lineTo(0, a);
  g.stroke({ color: ORIGIN_MARK.color, width: 1, alpha: ORIGIN_MARK.alpha });
  return g;
}

function midpointButton(): Graphics {
  const g = new Graphics({ label: "midpoint" });
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
 * Screen-sized rings around systems (selection, hover, move ghosts), the port ring and the
 * snap target's ring around a star or a zone's ring, plus the previews of an interaction in
 * progress: the ghosts' lanes, the rubber lines of a pending lane or link, the lanes a mesh
 * action would add, the marquee, and the hovered edge (a lane or a zone's link) with its "×"
 * and the selected lane, and the brush circle with what a held stroke would add, remove or cut.
 * It also marks the galaxy origin and, where the galaxy sets one, the
 * core radius stars are meant to stay outside of.
 */
export class HighlightsLayer implements MapLayer {
  readonly id = "highlights" as const;
  readonly container = new Container();
  private readonly hover = ring(HOVER);
  private readonly port = new Graphics({ label: "port", alpha: PORT_RING.alpha });
  private readonly target = new Graphics({ label: "target" });
  private readonly selectionRings: RingPool;
  private readonly ghostRings: RingPool;
  private readonly joiningRings: RingPool;
  private readonly leavingRings: RingPool;
  private readonly matchedRings: RingPool;
  private readonly midpoint = midpointButton();
  private readonly previewLines = new Graphics({ label: "previewLines" });
  private readonly laneLines = new Graphics({ label: "laneLines" });
  private readonly marqueeBox = new Graphics();
  private readonly feZoneGrid = new Graphics();
  private readonly ghostRing = new Graphics();
  private readonly origin = originCross();
  private readonly coreRing = new Graphics();
  private readonly brushLines = new Graphics({ label: "brushLines" });
  private readonly brushMarks = new Graphics({ label: "brushMarks" });
  private readonly brushCircle = new Graphics({ label: "brushCircle" });
  private brushPreview: BrushPreview | null = null;
  private coreRadius = EMPTY_CONTEXT.coreRadius;
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private selection: number[] = [];
  private hoverId: number | null = null;
  private hoverFeZone: number | null = null;
  private matched: ReadonlySet<number> = new Set();
  private ghosts: readonly MoveGhost[] = [];
  private dragged: ReadonlyMap<number, MoveGhost> = new Map();
  private rubber: RubberLane | null = null;
  private lanePreview: Array<[number, number]> | null = null;
  private marquee: WorldRect | null = null;
  private nebula: NebulaPreview | null = null;
  private feZone: FeZonePreview | null = null;
  private hoverEdge: MapEdge | null = null;
  private selectedLane: LaneRef | null = null;
  private camScale = 1;
  private markerK = 1;
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
      this.target,
      this.brushLines,
      this.brushMarks,
      this.brushCircle,
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
    this.markerK = markerScale(cam.scale);
    cam.childScale(this.markerK, this.scale);
    this.hover.scale.set(this.scale.x, this.scale.y);
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
      this.drawBrushMarks();
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

  /** The zone whose ring or port band the pointer is on, by its anchor; its port ring shows. */
  setHoverFeZone(anchor: number | null): void {
    if (anchor === this.hoverFeZone) return;
    this.hoverFeZone = anchor;
    this.drawPort();
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

  setBrushCursor(cursor: BrushCursor | null): void {
    const g = this.brushCircle;
    g.clear();
    if (!cursor) return;
    dashedCircle(g, cursor.x, cursor.y, cursor.r, BRUSH_DASHES);
    const color = cursor.tool === "paint" ? BRUSH_PAINT : BRUSH_ERASE;
    g.stroke({ color, alpha: 0.9, pixelLine: true });
  }

  setBrushPreview(preview: BrushPreview | null): void {
    this.brushPreview = preview;
    const g = this.brushLines;
    g.clear();
    if (preview) {
      for (const [a, b] of preview.lanes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (preview.lanes.length > 0) g.stroke({ ...GHOST_LANE, pixelLine: true });
    }
    this.drawBrushMarks();
  }

  setMarquee(rect: WorldRect | null): void {
    this.marquee = rect;
    this.drawMarquee();
  }

  setHoverEdge(edge: MapEdge | null): void {
    if (sameEdge(this.hoverEdge, edge)) return;
    this.hoverEdge = edge;
    this.drawLanes();
  }

  setSelectedLane(lane: LaneRef | null): void {
    if (sameLane(this.selectedLane, lane)) return;
    this.selectedLane = lane;
    this.drawLanes();
  }

  private placeAll(): void {
    this.selectionRings.place(
      this.selection.map((id) => this.systems.get(id)),
      (i) => (this.dragged.has(this.selection[i]) ? ORIGIN_ALPHA : 1),
    );
    const hoverId =
      this.hoverId !== null && this.selection.includes(this.hoverId) ? null : this.hoverId;
    this.place(this.hover, hoverId);
    this.drawPort();
    this.drawTarget();
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

  /** The centre of the ring `anchor` anchors, or undefined when it anchors none. */
  private zoneCentre(anchor: number): Pt | undefined {
    const s = this.systems.get(anchor);
    return s?.fe_zone ? feZoneCentre(s, s.fe_zone) : undefined;
  }

  /** A dashed ring in the middle of the port band: a star's in marker units, a zone's outside its ring band. */
  private drawPort(): void {
    const g = this.port;
    g.clear();
    if (this.rubber || this.ghosts.length > 0) return;
    const zone = this.hoverFeZone === null ? undefined : this.zoneCentre(this.hoverFeZone);
    if (zone) {
      const r = FE_ZONE_RADIUS + ringPortOffsetPx(this.markerK) / this.camScale;
      dashedCircle(g, zone.x, zone.y, r, FE_ZONE_PORT_DASHES);
      g.stroke({ color: PORT_RING.color, width: PORT_RING.width / this.camScale });
      return;
    }
    const star =
      this.portCapable && this.hoverId !== null ? this.systems.get(this.hoverId) : undefined;
    if (!star) return;
    const r = (((PORT_INNER + PORT_OUTER) / 2) * this.markerK) / this.camScale;
    dashedCircle(g, star.x, star.y, r, PORT_RING.dashes);
    g.stroke({ color: PORT_RING.color, width: (PORT_RING.width * this.markerK) / this.camScale });
  }

  /** The snap target's ring: around a star at the marker radius, around a zone just outside its ring. */
  private drawTarget(): void {
    const g = this.target;
    g.clear();
    const t = this.rubber?.target;
    if (!t) return;
    const style = t.valid ? TARGET_VALID : TARGET_INVALID;
    const at = t.kind === "system" ? this.systems.get(t.id) : this.zoneCentre(t.anchor);
    if (!at) return;
    const radius =
      t.kind === "system"
        ? (style.radius * this.markerK) / this.camScale
        : FE_ZONE_RADIUS + FE_ZONE_TARGET_MARGIN_PX / this.camScale;
    g.circle(at.x, at.y, radius).stroke({
      color: style.color,
      alpha: style.alpha,
      width: (style.width * this.markerK) / this.camScale,
    });
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
    const rubber = this.rubberSegments();
    for (const { a, b } of rubber) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (rubber.length > 0) g.stroke({ ...RUBBER_LANE, pixelLine: true });
  }

  /**
   * The rubber lines of a pending lane or link: from each dragged system, or from the dragged
   * zone's ring, to the snapped system, the snapped ring's nearest point, or the pointer.
   */
  private rubberSegments(): Segment[] {
    const r = this.rubber;
    if (!r) return [];
    const target = r.target;
    const targetSystem = target?.kind === "system" ? this.systems.get(target.id) : undefined;
    const targetZone = target?.kind === "feZone" ? this.zoneCentre(target.anchor) : undefined;
    const end = targetSystem ?? { x: r.x, y: r.y };
    if (r.from.kind === "feZone") {
      const centre = this.zoneCentre(r.from.anchor);
      const segment = centre && toRing(end, centre);
      return segment ? [segment] : [];
    }
    const segments: Segment[] = [];
    for (const id of r.from.ids) {
      const from = this.systems.get(id);
      if (!from) continue;
      const segment = targetZone ? toRing(from, targetZone) : { a: from, b: end };
      if (segment) segments.push(segment);
    }
    return segments;
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
    const tie = toRing(z.anchor, z);
    if (tie) g.moveTo(tie.a.x, tie.a.y).lineTo(tie.b.x, tie.b.y);
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

  /** The stroke's new systems as dots, its doomed and spared systems as rings, and the lanes it cuts, sized in screen pixels. */
  private drawBrushMarks(): void {
    const g = this.brushMarks;
    g.clear();
    const p = this.brushPreview;
    if (!p) return;
    const px = 1 / this.camScale;
    for (const [a, b] of p.cut) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (p.cut.length > 0) g.stroke({ color: BRUSH_ERASE, alpha: 0.9, width: BRUSH_CUT_PX * px });
    for (const s of p.points) g.circle(s.x, s.y, BRUSH_DOT_PX * px);
    if (p.points.length > 0) g.fill({ color: BRUSH_PAINT, alpha: 0.9 });
    for (const s of p.doomed) g.circle(s.x, s.y, BRUSH_RING_PX * px);
    if (p.doomed.length > 0) g.stroke({ color: BRUSH_ERASE, alpha: 0.9, width: 2 * px });
    for (const s of p.kept) g.circle(s.x, s.y, BRUSH_RING_PX * px);
    if (p.kept.length > 0) g.stroke({ color: BRUSH_KEPT, alpha: 0.9, width: 2 * px });
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
    const hovered = edgeEnds(this.systems, this.hoverEdge);
    const hoveredIsSelected =
      this.hoverEdge?.kind === "lane" && sameLane(this.hoverEdge.lane, this.selectedLane);
    if (hovered && !hoveredIsSelected) {
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

  private endpoints(lane: LaneRef | null): Segment | null {
    return edgeEnds(this.systems, lane && { kind: "lane", lane });
  }
}
