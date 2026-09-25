import { Container, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { LaneRef } from "../../store/editorStore";
import type { AddSystemPreview } from "../../store/mapChromeStore";
import { SPAWN_BUFFER } from "../../lib/addSystem";
import type { Camera } from "../Camera";
import { edgeEnds, sameEdge, sameLane, type MapEdge } from "../picking/edges";
import { MIDPOINT_HIT_PX } from "../picking/zones";
import { portCapable as portsAt } from "../../lib/visual/labels";
import type { Pt } from "../../lib/geometry/pt";
import { ghostLaneSegments, type MoveGhost } from "../moveGhosts";
import type { FeZonePreview } from "../feZonePreview";
import type { NebulaPreview } from "../nebulaPreview";
import type { Segment } from "../../lib/geometry/segments";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import {
  ACCENT_COLOR,
  ALLOWED_COLOR,
  CAUTION_COLOR,
  HANDLE_COLOR,
  MATCHED_COLOR,
  NEBULA_COLOR,
  REFUSED_COLOR,
  RING_RADIUS,
  SEARCHED_COLOR,
} from "../../lib/visual/style";
import { mapReach } from "../../lib/guides";
import { AddedMarks } from "./highlights/AddedMarks";
import { BrushOverlay } from "./highlights/BrushOverlay";
import { dashedCircle } from "./dashes";
import { FeZoneDragOverlay } from "./highlights/FeZoneDragOverlay";
import { LaneDragOverlay } from "./highlights/LaneDragOverlay";
import { pointsOf, RingBatch, type RingSpec } from "./highlights/RingBatch";
import { SymmetryGuide } from "./highlights/SymmetryGuide";
import { markerScale, sameDragged, type DragState, type MapLayer } from "./MapLayer";

const SELECTION: RingSpec = {
  color: ACCENT_COLOR,
  radius: RING_RADIUS.selection,
  width: 2,
  alpha: 1,
};
const HOVER = { color: 0xffffff, radius: RING_RADIUS.hover, width: 1.5, alpha: 0.6 };
const GHOST = { color: ACCENT_COLOR, radius: RING_RADIUS.selection, width: 2, alpha: 1 };
/** Systems using the initializer the browser is highlighting: muted, distinct from selection and hover. */
const MATCHED = { color: MATCHED_COLOR, radius: RING_RADIUS.target, width: 2, alpha: 0.6 };
/** Systems the search palette's query locates, while it holds one. */
const SEARCHED = { color: SEARCHED_COLOR, radius: RING_RADIUS.searched, width: 2.5, alpha: 1 };
/** Systems a nebula drag would take in, and those it would let go. */
const JOINING = { color: ALLOWED_COLOR, radius: RING_RADIUS.joining, width: 2, alpha: 0.85 };
const LEAVING = { color: CAUTION_COLOR, radius: RING_RADIUS.joining, width: 2, alpha: 0.85 };
const GHOST_LANE = { color: ACCENT_COLOR, alpha: 0.9 };
const HOVER_LANE = { color: 0xffffff, alpha: 0.5, widthPx: 3 };
const SELECTED_LANE = { color: ACCENT_COLOR, alpha: 0.9, widthPx: 4 };
const MIDPOINT = { fill: HANDLE_COLOR, stroke: 0xffffff, arm: 3.5 };
const MARQUEE = { color: ACCENT_COLOR, strokeAlpha: 0.9, fillAlpha: 0.08 };
/** The dashed ring a nebula drag proposes, until the pointer comes up. */
const GHOST_RING = { color: NEBULA_COLOR, alpha: 0.9 };
const GHOST_RING_DASHES = 48;
const ORIGIN_MARK = { color: 0xffffff, alpha: 0.3, armPx: 7 };
/** Where a system is being added: the spawn buffer, clear or not, and the galaxy's edge it is past. */
const ADD_CLEAR = { color: ALLOWED_COLOR, alpha: 0.9 };
const ADD_REFUSED = { color: REFUSED_COLOR, alpha: 0.9 };
const ADD_BUFFER_DASHES = 24;
const ADD_EDGE_DASHES = 160;
/** "Keep stars outside": the galaxy's core radius, as thin and faint as the origin mark. */
const CORE_RING = { color: ORIGIN_MARK.color, alpha: ORIGIN_MARK.alpha };

/** A world-space rectangle with `x0 <= x1` and `y0 <= y1`. */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function ring(spec: RingSpec): Graphics {
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
  private readonly addPreviewLines = new Graphics({ label: "addSystemPreview" });
  /** The plus on every system added this session. */
  private readonly added = new AddedMarks();
  /** The brush circle and what a held stroke would do. */
  readonly brush = new BrushOverlay();
  readonly laneDrag = new LaneDragOverlay();
  /** The axis or spokes of the symmetry edits repeat under. */
  readonly guide = new SymmetryGuide(mapReach(EMPTY_CONTEXT.kind, EMPTY_CONTEXT.radius));
  private readonly feZoneDrag = new FeZoneDragOverlay();
  private coreRadius = EMPTY_CONTEXT.coreRadius;
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private selection: ReadonlySet<number> = new Set();
  private hoverId: number | null = null;
  private matched: ReadonlySet<number> = new Set();
  private searched: ReadonlySet<number> = new Set();
  private ghosts: readonly MoveGhost[] = [];
  private dragged: ReadonlyMap<number, MoveGhost> = new Map();
  private lanePreview: Array<[number, number]> | null = null;
  private addPreview: AddSystemPreview | null = null;
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
      this.laneDrag.lines,
      this.addPreviewLines,
      this.marqueeBox,
      this.feZoneDrag.container,
      this.ghostRing,
      this.laneDrag.port,
      this.hover,
      this.laneDrag.target,
      this.brush.container,
    );
    this.container.addChild(
      this.selectionRings.container,
      this.ghostRings.container,
      this.matchedRings.container,
      this.searchedRings.container,
      this.joiningRings.container,
      this.leavingRings.container,
      this.added.container,
      this.midpoint,
    );
  }

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    this.laneDrag.setSystems(ctx.systems);
    if (ctx.coreRadius !== this.coreRadius) {
      this.coreRadius = ctx.coreRadius;
      this.drawCoreRing();
    }
    this.guide.setReach(mapReach(ctx.kind, ctx.radius));
    if (!loaded) return;
    this.added.place(this.systems);
    this.drawAddPreview();
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
    this.added.place(this.systems);
    this.drawAddPreview();
    this.placeAll();
    this.drawPreviews();
    this.drawLanes();
  }

  onViewport(cam: Camera): void {
    this.markerK = markerScale(cam.scale);
    cam.childScale(this.markerK, this.scale);
    this.hover.scale.set(this.scale.x, this.scale.y);
    for (const rings of this.batches()) rings.setScale(this.scale);
    this.added.setScale(this.scale);
    cam.childScale(1, this.pixelScale);
    this.midpoint.scale.set(this.pixelScale.x, this.pixelScale.y);
    this.origin.scale.set(this.pixelScale.x, this.pixelScale.y);
    const portCapable = portsAt(cam.scale);
    if (cam.scale !== this.camScale || portCapable !== this.portCapable) {
      this.camScale = cam.scale;
      this.portCapable = portCapable;
      this.laneDrag.onScale(cam.scale, this.markerK, portCapable);
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
    this.added.destroy();
  }

  setSelection(ids: readonly number[]): void {
    this.selection = new Set(ids);
    this.placeSelection();
    this.placeHover();
  }

  setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.laneDrag.setHover(id);
    this.placeHover();
  }

  setDragState(drag: DragState | null): void {
    const dragged = drag?.byId ?? new Map<number, MoveGhost>();
    const same = sameDragged(dragged, this.dragged);
    this.ghosts = drag?.ghosts ?? [];
    this.laneDrag.setMoving(this.ghosts.length > 0);
    this.dragged = dragged;
    if (!same) this.placeSelection();
    this.placeAll();
    this.drawPreviews();
  }

  setLanePreview(pairs: Array<[number, number]> | null): void {
    this.lanePreview = pairs;
    this.drawPreviews();
  }

  setAddSystemPreview(preview: AddSystemPreview | null): void {
    this.addPreview = preview;
    this.drawAddPreview();
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
  }

  /** Everything but the selection, matched and searched systems: a handful of rings at most. */
  private placeAll(): void {
    this.placeHover();
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
  }

  private drawAddPreview(): void {
    const g = this.addPreviewLines;
    g.clear();
    const p = this.addPreview;
    if (!p) return;
    dashedCircle(g, p.x, p.y, SPAWN_BUFFER, ADD_BUFFER_DASHES);
    g.stroke({ ...(p.tooClose ? ADD_REFUSED : ADD_CLEAR), pixelLine: true });
    if (p.edge !== null) {
      dashedCircle(g, 0, 0, p.edge, ADD_EDGE_DASHES);
      g.stroke({ ...ADD_REFUSED, pixelLine: true });
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
