import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
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
import { FE_ZONE_RADIUS, feZoneCentre } from "../../lib/feZone";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import {
  ACCENT_COLOR,
  ALLOWED_COLOR,
  CAUTION_COLOR,
  ORIGIN_ALPHA,
  REFUSED_COLOR,
} from "../../lib/visual/style";
import { SCENARIO_HALF_EXTENT } from "../../lib/guides";
import { destroyChildren } from "./destroyChildren";
import { BrushOverlay } from "./highlights/BrushOverlay";
import { dashedCircle } from "./highlights/dashedCircle";
import { FeZoneDragOverlay } from "./highlights/FeZoneDragOverlay";
import { SymmetryGuide } from "./highlights/SymmetryGuide";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

const SELECTION = { color: ACCENT_COLOR, radius: 11, width: 2, alpha: 1 };
const HOVER = { color: 0xffffff, radius: 9, width: 1.5, alpha: 0.6 };
const GHOST = { color: ACCENT_COLOR, radius: 11, width: 2, alpha: 1 };
/** Systems using the initializer the browser is highlighting: muted, distinct from selection and hover. */
const MATCHED = { color: 0x7dd3fc, radius: 13, width: 2, alpha: 0.6 };
/** Systems the search palette's query locates, while it holds one. */
const SEARCHED = { color: 0xf472b6, radius: 14, width: 2, alpha: 0.8 };
const TARGET_VALID = { color: ALLOWED_COLOR, radius: 13, width: 2, alpha: 0.9 };
/** Systems a nebula drag would take in, and those it would let go. */
const JOINING = { color: ALLOWED_COLOR, radius: 15, width: 2, alpha: 0.85 };
const LEAVING = { color: CAUTION_COLOR, radius: 15, width: 2, alpha: 0.85 };
const TARGET_INVALID = { color: REFUSED_COLOR, radius: 13, width: 2, alpha: 0.9 };
/** How far outside a targeted zone's ring its target ring is drawn, in screen pixels. */
const FE_ZONE_TARGET_MARGIN_PX = 14;
const PORT_RING = { color: ALLOWED_COLOR, alpha: 0.45, hotAlpha: 1, width: 1.5, dashes: 16 };
/** A zone's port ring is longer than a star's, so it takes more dashes to read the same. */
const FE_ZONE_PORT_DASHES = 48;
const GHOST_LANE = { color: ACCENT_COLOR, alpha: 0.9 };
const RUBBER_LANE = { color: ALLOWED_COLOR, alpha: 0.9 };
const HOVER_LANE = { color: 0xffffff, alpha: 0.5, widthPx: 3 };
const SELECTED_LANE = { color: ACCENT_COLOR, alpha: 0.9, widthPx: 4 };
const MIDPOINT = { fill: 0x1c2333, stroke: 0xffffff, arm: 3.5 };
const MARQUEE = { color: ACCENT_COLOR, strokeAlpha: 0.9, fillAlpha: 0.08 };
/** The dashed ring a nebula drag proposes, until the pointer comes up. */
const GHOST_RING = { color: 0xc4b5fd, alpha: 0.9 };
const GHOST_RING_DASHES = 48;
const ORIGIN_MARK = { color: 0xffffff, alpha: 0.3, armPx: 7 };
/** "Keep stars outside": the galaxy's core radius, as thin and faint as the origin mark. */
const CORE_RING = { color: ORIGIN_MARK.color, alpha: ORIGIN_MARK.alpha };

export interface RubberLane {
  from: LaneSource;
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

/** How far the symmetry guides run: a save's galaxy radius, or out to a scenario's corners. */
function guideReachOf(ctx: RenderContext): number {
  return ctx.kind === "save" && ctx.radius > 0 ? ctx.radius : SCENARIO_HALF_EXTENT * Math.SQRT2;
}

function ring(spec: typeof SELECTION): Graphics {
  const g = new Graphics();
  g.circle(0, 0, spec.radius).stroke({ color: spec.color, width: spec.width, alpha: spec.alpha });
  g.visible = false;
  return g;
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
  const g = new Graphics({ label: "midpoint" });
  const a = MIDPOINT.arm;
  g.circle(0, 0, MIDPOINT_HIT_PX).fill({ color: MIDPOINT.fill, alpha: 0.85 });
  g.circle(0, 0, MIDPOINT_HIT_PX).stroke({ color: MIDPOINT.stroke, width: 1, alpha: 0.6 });
  g.moveTo(-a, -a).lineTo(a, a).moveTo(a, -a).lineTo(-a, a);
  g.stroke({ color: MIDPOINT.stroke, width: 1.5, alpha: 0.9 });
  g.visible = false;
  return g;
}

/** Spare rings kept past what a placement needs before the rest are destroyed. */
const SPARE_RINGS = 256;

/**
 * Identical rings around any number of points, some of them dimmed: one shape shared by every
 * ring, so a zoom only rescales them and a placement only moves them.
 */
class RingBatch {
  readonly container: Container;
  private readonly shape: GraphicsContext;
  private readonly rings: Graphics[] = [];
  private shown = 0;
  private readonly scale: Pt = { x: 1, y: 1 };

  constructor(spec: typeof SELECTION, label: string) {
    this.container = new Container({ label });
    this.shape = new GraphicsContext()
      .circle(0, 0, spec.radius)
      .stroke({ color: spec.color, width: spec.width, alpha: spec.alpha });
  }

  place(bright: readonly Pt[], dimmed: readonly Pt[] = []): void {
    const count = bright.length + dimmed.length;
    while (this.rings.length < count) {
      const g = new Graphics(this.shape);
      this.rings.push(g);
      this.container.addChild(g);
    }
    for (let i = 0; i < count; i++) {
      const g = this.rings[i];
      const at = i < bright.length ? bright[i] : dimmed[i - bright.length];
      g.position.set(at.x, at.y);
      g.scale.set(this.scale.x, this.scale.y);
      g.alpha = i < bright.length ? 1 : ORIGIN_ALPHA;
      g.visible = true;
    }
    for (let i = count; i < this.shown; i++) this.rings[i].visible = false;
    this.shown = count;
    if (this.rings.length - count > SPARE_RINGS) {
      destroyChildren(this.container, new Set(this.rings.splice(count + SPARE_RINGS)));
    }
  }

  setScale(scale: Pt): void {
    if (scale.x === this.scale.x && scale.y === this.scale.y) return;
    this.scale.x = scale.x;
    this.scale.y = scale.y;
    for (let i = 0; i < this.shown; i++) this.rings[i].scale.set(scale.x, scale.y);
  }

  destroy(): void {
    this.shape.destroy();
  }
}

/** The systems of `ids` the map holds, skipping the rest. */
function pointsOf(systems: Systems, ids: Iterable<number>): Pt[] {
  const points: Pt[] = [];
  for (const id of ids) {
    const s = systems.get(id);
    if (s) points.push(s);
  }
  return points;
}

function touches(d: GalaxyDelta, ids: ReadonlySet<number>): boolean {
  if (ids.size === 0) return false;
  return d.systems.some((s) => ids.has(s.id)) || (d.removed ?? []).some((id) => ids.has(id));
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
  private readonly selectionRings = new RingBatch(SELECTION, "selectionRings");
  private readonly ghostRings = new RingBatch(GHOST, "ghostRings");
  private readonly matchedRings = new RingBatch(MATCHED, "matchedRings");
  private readonly searchedRings = new RingBatch(SEARCHED, "searchedRings");
  private readonly joiningRings = new RingBatch(JOINING, "joiningRings");
  private readonly leavingRings = new RingBatch(LEAVING, "leavingRings");
  private readonly midpoint = midpointButton();
  private readonly previewLines = new Graphics({ label: "previewLines" });
  private readonly laneLines = new Graphics({ label: "laneLines" });
  private readonly marqueeBox = new Graphics();
  private readonly ghostRing = new Graphics();
  private readonly origin = originCross();
  private readonly coreRing = new Graphics();
  /** The brush circle and what a held stroke would do. */
  readonly brush = new BrushOverlay();
  /** The axis or spokes of the symmetry edits repeat under. */
  readonly guide = new SymmetryGuide(guideReachOf(EMPTY_CONTEXT));
  private readonly feZoneDrag = new FeZoneDragOverlay();
  private coreRadius = EMPTY_CONTEXT.coreRadius;
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private selection: ReadonlySet<number> = new Set();
  private hoverId: number | null = null;
  private hoverFeZone: number | null = null;
  private matched: ReadonlySet<number> = new Set();
  private searched: ReadonlySet<number> = new Set();
  private ghosts: readonly MoveGhost[] = [];
  private dragged: ReadonlyMap<number, MoveGhost> = new Map();
  private rubber: RubberLane | null = null;
  private lanePreview: Array<[number, number]> | null = null;
  private marquee: WorldRect | null = null;
  private nebula: NebulaPreview | null = null;
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
      this.guide.graphics,
      this.origin,
      this.laneLines,
      this.previewLines,
      this.marqueeBox,
      this.feZoneDrag.container,
      this.ghostRing,
      this.port,
      this.hover,
      this.target,
      this.brush.container,
    );
    this.container.addChild(
      this.selectionRings.container,
      this.ghostRings.container,
      this.matchedRings.container,
      this.searchedRings.container,
      this.joiningRings.container,
      this.leavingRings.container,
      this.midpoint,
    );
  }

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (ctx.coreRadius !== this.coreRadius) {
      this.coreRadius = ctx.coreRadius;
      this.drawCoreRing();
    }
    this.guide.setReach(guideReachOf(ctx));
    if (!loaded) return;
    this.placeSelection();
    this.placeMatched();
    this.placeSearched();
    this.placeAll();
    this.drawPreviews();
    this.drawLanes();
  }

  applyDelta(d: GalaxyDelta): void {
    if (touches(d, this.selection)) this.placeSelection();
    if (touches(d, this.matched)) this.placeMatched();
    if (touches(d, this.searched)) this.placeSearched();
    this.placeAll();
    this.drawPreviews();
    this.drawLanes();
  }

  onViewport(cam: Camera): void {
    this.markerK = markerScale(cam.scale);
    cam.childScale(this.markerK, this.scale);
    this.hover.scale.set(this.scale.x, this.scale.y);
    for (const rings of this.batches()) rings.setScale(this.scale);
    cam.childScale(1, this.pixelScale);
    this.midpoint.scale.set(this.pixelScale.x, this.pixelScale.y);
    this.origin.scale.set(this.pixelScale.x, this.pixelScale.y);
    const portCapable = portsAt(cam.scale);
    if (cam.scale !== this.camScale || portCapable !== this.portCapable) {
      this.camScale = cam.scale;
      this.portCapable = portCapable;
      this.placeAll();
      this.drawLanes();
      this.feZoneDrag.onScale(cam.scale);
      this.brush.onScale(cam.scale);
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const rings of this.batches()) rings.destroy();
  }

  setSelection(ids: readonly number[]): void {
    this.selection = new Set(ids);
    this.placeSelection();
    this.placeHover();
  }

  setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.placeHover();
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
    const dragged = drag?.byId ?? new Map<number, MoveGhost>();
    const same =
      dragged.size === this.dragged.size && [...dragged.keys()].every((id) => this.dragged.has(id));
    this.ghosts = drag?.ghosts ?? [];
    this.dragged = dragged;
    if (!same) this.placeSelection();
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
    this.placeMatched();
  }

  setSearched(ids: ReadonlySet<number>): void {
    this.searched = ids;
    this.placeSearched();
  }

  /** The ghost ring a nebula drag is proposing, with the systems it would gain and lose. */
  setNebulaPreview(preview: NebulaPreview | null): void {
    this.nebula = preview;
    this.placeAll();
    this.drawGhostRing();
  }

  /** The ring a zone drag is proposing, with the system it would cover ringed as leaving. */
  setFeZonePreview(preview: FeZonePreview | null): void {
    this.feZoneDrag.set(preview);
    this.placeAll();
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

  private batches(): RingBatch[] {
    return [
      this.selectionRings,
      this.ghostRings,
      this.matchedRings,
      this.searchedRings,
      this.joiningRings,
      this.leavingRings,
    ];
  }

  /** The selection's rings, the dragged ones dimmed; redrawn only when it, a drag or the zoom changes. */
  private placeSelection(): void {
    const bright: Pt[] = [];
    const dimmed: Pt[] = [];
    for (const id of this.selection) {
      const s = this.systems.get(id);
      if (s) (this.dragged.has(id) ? dimmed : bright).push(s);
    }
    this.selectionRings.place(bright, dimmed);
  }

  private placeMatched(): void {
    this.matchedRings.place(pointsOf(this.systems, this.matched));
  }

  private placeSearched(): void {
    this.searchedRings.place(pointsOf(this.systems, this.searched));
  }

  /** The hover ring, unless the selection already rings that system, and the port ring. */
  private placeHover(): void {
    const hoverId = this.hoverId !== null && this.selection.has(this.hoverId) ? null : this.hoverId;
    this.place(this.hover, hoverId);
    this.drawPort();
  }

  /** Everything but the selection, matched and searched systems: a handful of rings at most. */
  private placeAll(): void {
    this.placeHover();
    this.drawTarget();
    this.ghostRings.place(this.ghosts);
    this.joiningRings.place(pointsOf(this.systems, this.nebula?.joining ?? []));
    const covered = this.feZoneDrag.preview?.blocked;
    this.leavingRings.place([
      ...pointsOf(this.systems, this.nebula?.leaving ?? []),
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
