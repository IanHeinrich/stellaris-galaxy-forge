import { Container, Graphics } from "pixi.js";
import { stepText, turnText } from "../../../lib/details/labels";
import { polar, wholeTurn } from "../../../lib/details/orbits";
import {
  ACCENT_COLOR,
  CAUTION_COLOR,
  GHOST_ALPHA,
  MATCHED_COLOR,
  REFUSED_COLOR,
} from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { dashedCircle, dashedLine } from "../../layers/dashes";
import { sameHandle, type DragMarks, type HandleRef } from "../bodyDrag";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import {
  drawnDisc,
  exitTriangle,
  ringDashes,
  SELECTED_GAP_PX,
  SELECTED_WIDTH_PX,
} from "../geometry";
import { HANDLE_RADIUS_PX } from "./HandlesLayer";
import { plateScaleAt } from "./labelSlots";
import { standTag, TagCache, tagBox, type RadiusTag } from "./plate";
import {
  NO_HIGHLIGHT,
  type PasteGhost,
  type SceneHighlight,
  type SystemLayer,
} from "./SystemLayer";

const HOVER_COLOR = 0xffffff;
const HOVER_ALPHA = 0.75;
/** Past the drawn disc, and the stroke width, in screen pixels. */
const HOVER_GAP_PX = 4;
const RING_WIDTH_PX = 1.5;
/** How much bigger the highlighted lane's arrow is drawn, in screen pixels. */
const LANE_GROW_PX = 3;
/** The selected body's radius line, and its gap from the disc it starts at, in screen pixels. */
const RADIUS_LINE_ALPHA = 0.7;
const RADIUS_HUB_GAP_PX = 2;
/**
 * The selected body's turn: its rays faint, reaching past its ring, and the stretch of its ring
 * it may stand on lit; its label stands out past the ring, all in screen pixels.
 */
const TURN_RAY_ALPHA = 0.35;
const TURN_RAY_REACH_PX = 12;
const TURN_ARC_ALPHA = 0.5;
const TURN_ARC_WIDTH_PX = 2;
const TURN_LABEL_OUT_PX = 16;
/** The stretch of radii a selected scenario body's orbit may be rolled within, faint. */
const BAND_ALPHA = 0.08;
/** What a selected scenario body's orbit and angle are measured from, apart from the selection. */
const BASE_COLOR = MATCHED_COLOR;
/**
 * The outline of the body its angle turns from: dashed and thinner than the selection ring, and
 * brighter while a panel's link to that body is under the pointer; widths in screen pixels.
 */
const ANCHOR_DASHES = 12;
const ANCHOR_WIDTH_PX = 1;
const ANCHOR_ALPHA = 0.8;
const LINKED_ANCHOR_WIDTH_PX = 2.5;
/** The ray through that body and the circle of the orbit it steps out from, in screen pixels. */
const BASE_ALPHA = 0.5;
const BASE_DASH_PX = 4;
const BASE_GAP_PX = 4;
const BASE_MAX_DASHES = 360;
/** The stretch of the radius line its step covers, in screen pixels. */
const STEP_WIDTH_PX = 2;
/**
 * A drag's marks: the ring the body lands on, dashed on its own ring and solid on one it shares or
 * overlaps; the soft ring round the body it shares with; the ring round a host or a body that
 * refuses it; and a hovered or dragged handle, grown past the drawn one. Widths in screen pixels.
 */
const TARGET_WIDTH_PX = 1.5;
const OWN_RING_ALPHA = 0.8;
const SOFT_ALPHA = 0.5;
const HANDLE_GROW_PX = 2;
/** A moon that comes along with its selected planet: a fainter, tighter ring than the selection. */
const COMES_ALONG_ALPHA = 0.45;
/** A cut body and its moons: a dashed outline where the selection ring would stand. */
const CUT_COLOR = 0xffffff;
const CUT_ALPHA = 0.75;
const CUT_DASHES = 12;
/** Where a lone cut planet would be pasted: its orbit dashed, its disc faint as a drag ghost. */
const PASTE_RING_ALPHA = 0.85;

type TagSlot = "radius" | "turn" | "step";

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** How far from its ring's centre a body's radius line and rays start: clear of the disc there. */
function hubReach(body: SceneBody, cam: Camera): number {
  const hub = body.readout?.hub ?? 0;
  return hub > 0 ? drawnDisc(hub, cam.scale) + RADIUS_HUB_GAP_PX / cam.scale : 0;
}

/**
 * The hover ring, the selection rings and the highlighted lane's arrow, and a line from what the
 * selected body orbits out to it, labelled with its radius. The moons of a planet selected to move
 * have a fainter ring, and cut bodies a dashed outline. A lone cut planet's paste shows as a ghost.
 * A scenario body's turn from the body before it shows as two rays from its ring's centre with the
 * stretch of ring between them lit. What a scenario body is measured from is marked in a colour of
 * its own: the body it turns from, with a ray through it where the turn starts, and the orbit it
 * steps out from, with the step's stretch of the radius line labelled. Its ranged orbit shows as a
 * faint band between its radii.
 */
export class HighlightLayer implements SystemLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  readonly radiusLine = new Graphics();
  readonly turnRayMin = new Graphics();
  readonly turnRayMax = new Graphics();
  readonly turnArc = new Graphics();
  readonly anchorRing = new Graphics();
  readonly anchorRay = new Graphics();
  readonly baseCircle = new Graphics();
  readonly stepLine = new Graphics();
  readonly band = new Graphics();
  readonly dragMarks = new Graphics();
  readonly cutRings = new Graphics();
  readonly pasteGhost = new Graphics();
  private readonly tags = new TagCache<TagSlot>(this.container);
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private ref: SceneHighlight = NO_HIGHLIGHT;
  private hoveredHandle: HandleRef | null = null;
  private cam: Camera | null = null;
  private drawnRev = -1;

  constructor() {
    this.radiusLine.label = "radius-line";
    this.turnRayMin.label = "turn-ray-min";
    this.turnRayMax.label = "turn-ray-max";
    this.turnArc.label = "turn-arc";
    this.anchorRing.label = "anchor-ring";
    this.anchorRay.label = "anchor-ray";
    this.baseCircle.label = "base-circle";
    this.stepLine.label = "step-line";
    this.band.label = "orbit-band";
    this.dragMarks.label = "drag";
    this.cutRings.label = "cut";
    this.pasteGhost.label = "paste-ghost";
    this.container.addChild(
      this.pasteGhost,
      this.dragMarks,
      this.cutRings,
      this.band,
      this.baseCircle,
      this.anchorRay,
      this.turnArc,
      this.turnRayMin,
      this.turnRayMax,
      this.radiusLine,
      this.stepLine,
      this.anchorRing,
      this.g,
    );
  }

  rebuild(ctx: SystemContext): void {
    this.ctx = ctx;
    this.redraw();
  }

  setHighlighted(ref: SceneHighlight): void {
    this.ref = ref;
    this.redraw();
  }

  /** Marks the handle under the pointer, or none. */
  hoverHandle(handle: HandleRef | null): void {
    if (sameHandle(handle, this.hoveredHandle)) return;
    this.hoveredHandle = handle;
    this.redraw();
  }

  onViewport(cam: Camera): void {
    this.cam = cam;
    if (cam.rev === this.drawnRev) return;
    this.redraw();
  }

  private redraw(): void {
    const cam = this.cam;
    const g = this.g.clear();
    if (!cam) return;
    this.drawnRev = cam.rev;
    const id = this.ref.selectedBody;
    const selected = id === null ? undefined : this.ctx.bodyById.get(id);
    this.drawRadius(cam, selected);
    this.drawTurn(cam, selected);
    this.drawAnchor(cam, selected);
    this.drawBand(selected);
    this.drawDrag(cam, this.ctx.drag);
    this.drawPasteGhost(cam, this.ref.pasteGhost);
    const cut = this.drawCut(cam);
    const px = 1 / cam.scale;
    const ring = (id: number | null, gap: number, width: number, color: number, alpha: number) => {
      const body = id === null ? undefined : this.ctx.bodyById.get(id);
      if (!body) return;
      const { x, y, disc } = body.placement;
      g.circle(x, y, drawnDisc(disc, cam.scale, body.look) + gap * px).stroke({
        color,
        alpha,
        width: width * px,
      });
    };
    ring(this.ref.hoverBody, HOVER_GAP_PX, RING_WIDTH_PX, HOVER_COLOR, HOVER_ALPHA);
    const selectedIds = new Set(this.ref.selectedBodies);
    if (this.ref.selectedBody !== null) selectedIds.add(this.ref.selectedBody);
    for (const selectedId of selectedIds) {
      if (!cut.has(selectedId)) {
        ring(selectedId, SELECTED_GAP_PX, SELECTED_WIDTH_PX, ACCENT_COLOR, 1);
      }
    }
    for (const moon of this.movingMoons(this.ref.selectedBodies)) {
      if (!selectedIds.has(moon) && !cut.has(moon)) {
        ring(moon, HOVER_GAP_PX, RING_WIDTH_PX, ACCENT_COLOR, COMES_ALONG_ALPHA);
      }
    }
    for (const exit of this.ctx.exits) {
      if (exit.neighbour === this.ref.lane) {
        g.poly(exitTriangle(exit, cam.scale, LANE_GROW_PX)).fill({ color: ACCENT_COLOR });
      } else if (exit.neighbour === this.ref.hoverExit) {
        g.poly(exitTriangle(exit, cam.scale, 1)).stroke({
          color: HOVER_COLOR,
          alpha: HOVER_ALPHA,
          width: RING_WIDTH_PX * px,
        });
      }
    }
  }

  /**
   * The selected body's radius: a line from the disc at its ring's centre, or the centre itself,
   * out to its selection ring, and its readout on a plate at the line's middle. A scenario body
   * that steps out from an orbit past the centre also has that orbit's circle, and its step as
   * the stretch of line from the circle out, on a plate of its own; its radius plate stands on
   * the stretch inside the circle.
   */
  private drawRadius(cam: Camera, body: SceneBody | undefined): void {
    const line = this.radiusLine.clear();
    const stepLine = this.stepLine.clear();
    const baseCircle = this.baseCircle.clear();
    const tag = this.tagFor("radius", body?.readout?.text ?? null);
    const ring = body?.placement.ring;
    const base = body?.placement.radius?.base ?? 0;
    const step = body?.placement.radius?.step ?? null;
    const stepTag = this.tagFor("step", ring && step && base > 0 ? stepText(step) : null);
    if (!body?.readout || !ring || !tag) return;
    const { x, y, disc } = body.placement;
    const length = ring.radius;
    const px = 1 / cam.scale;
    const from = hubReach(body, cam);
    const to = length - drawnDisc(disc, cam.scale, body.look) - SELECTED_GAP_PX * px;
    if (to <= from) return;
    const ux = (x - ring.cx) / length;
    const uy = (y - ring.cy) / length;
    const along = (d: number) => ({ x: ring.cx + ux * d, y: ring.cy + uy * d });
    const standAt = (plate: RadiusTag, d: number) => {
      const at = cam.worldToScreen(along(d).x, along(d).y);
      this.stand(plate, cam, body.placement.id, at.x, at.y);
    };
    line
      .moveTo(along(from).x, along(from).y)
      .lineTo(along(to).x, along(to).y)
      .stroke({ color: ACCENT_COLOR, alpha: RADIUS_LINE_ALPHA, pixelLine: true });
    if (base > 0) {
      const around = (2 * Math.PI * base * cam.scale) / (BASE_DASH_PX + BASE_GAP_PX);
      const dashes = Math.min(BASE_MAX_DASHES, Math.max(ANCHOR_DASHES, Math.round(around)));
      const ink = BASE_DASH_PX / (BASE_DASH_PX + BASE_GAP_PX);
      dashedCircle(baseCircle, ring.cx, ring.cy, base, dashes, ink);
      baseCircle.stroke({ color: BASE_COLOR, alpha: BASE_ALPHA, pixelLine: true });
    }
    const start = Math.max(from, base);
    if (!stepTag || start >= to) {
      standAt(tag, (from + to) / 2);
      return;
    }
    stepLine
      .moveTo(along(start).x, along(start).y)
      .lineTo(along(to).x, along(to).y)
      .stroke({ color: BASE_COLOR, width: STEP_WIDTH_PX * px });
    standAt(stepTag, (start + to) / 2);
    standAt(tag, base > from ? (from + base) / 2 : (from + to) / 2);
  }

  /**
   * The selected scenario body's turn: a ray from its ring's centre at each end of the turn from
   * the body before it, the stretch of its ring between them lit, and the turn on a plate past
   * the ring. A turn of a whole turn or more lights the whole ring and has no rays.
   */
  private drawTurn(cam: Camera, body: SceneBody | undefined): void {
    const rays = [this.turnRayMin.clear(), this.turnRayMax.clear()];
    const arc = this.turnArc.clear();
    const turn = body?.placement.turn;
    const ring = body?.placement.ring;
    const tag = this.tagFor("turn", turn && ring ? turnText(turn.step) : null);
    if (!body || !turn || !ring || !tag) return;
    const px = 1 / cam.scale;
    const { cx, cy, radius } = ring;
    const from = turn.from + turn.step.min;
    const to = turn.from + turn.step.max;
    if (wholeTurn(turn.step)) {
      arc.circle(cx, cy, radius);
    } else {
      const start = radians(from);
      arc
        .moveTo(cx + radius * Math.cos(start), cy + radius * Math.sin(start))
        .arc(cx, cy, radius, start, radians(to));
      const near = hubReach(body, cam);
      const far = radius + TURN_RAY_REACH_PX * px;
      [from, to].forEach((degrees, i) => {
        const a = polar(cx, cy, near, degrees);
        const b = polar(cx, cy, far, degrees);
        rays[i]
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({ color: ACCENT_COLOR, alpha: TURN_RAY_ALPHA, pixelLine: true });
      });
    }
    arc.stroke({ color: ACCENT_COLOR, alpha: TURN_ARC_ALPHA, width: TURN_ARC_WIDTH_PX * px });
    const label = polar(cx, cy, radius + TURN_LABEL_OUT_PX * px, (from + to) / 2);
    const at = cam.worldToScreen(label.x, label.y);
    this.stand(tag, cam, body.placement.id, at.x, at.y);
  }

  /**
   * The selected scenario body's anchor: a dashed outline round the body before it in its walk,
   * which it turns from, and a faint dashed ray from its ring's centre through that body, where
   * the turn starts. A body with no anchor, the first of its walk or one after a body at the
   * centre, has neither.
   */
  private drawAnchor(cam: Camera, body: SceneBody | undefined): void {
    const outline = this.anchorRing.clear();
    const ray = this.anchorRay.clear();
    const turn = body?.placement.turn;
    const ring = body?.placement.ring;
    if (!body || !turn || !ring || turn.anchor === null) return;
    const anchor = this.ctx.bodyById.get(turn.anchor);
    if (!anchor) return;
    const px = 1 / cam.scale;
    const { x, y, disc } = anchor.placement;
    const r = drawnDisc(disc, cam.scale, anchor.look) + SELECTED_GAP_PX * px;
    const linked = this.ref.linkedBody === turn.anchor;
    dashedCircle(outline, x, y, r, ANCHOR_DASHES);
    outline.stroke({
      color: BASE_COLOR,
      alpha: linked ? 1 : ANCHOR_ALPHA,
      width: (linked ? LINKED_ANCHOR_WIDTH_PX : ANCHOR_WIDTH_PX) * px,
    });
    const reach = Math.max(ring.radius, Math.hypot(x - ring.cx, y - ring.cy) + r);
    const near = hubReach(body, cam);
    const far = reach + TURN_RAY_REACH_PX * px;
    dashedLine(
      ray,
      polar(ring.cx, ring.cy, near, turn.from),
      polar(ring.cx, ring.cy, far, turn.from),
      BASE_DASH_PX * px,
      BASE_GAP_PX * px,
    );
    ray.stroke({ color: BASE_COLOR, alpha: BASE_ALPHA, pixelLine: true });
  }

  /**
   * What a drag marks: a faint disc where the body stood, the ring it lands on, the body it shares
   * that ring with or stands on, a host or a refusing body ringed, and the handle held or hovered.
   */
  private drawDrag(cam: Camera, drag: DragMarks | null): void {
    const g = this.dragMarks.clear();
    const px = 1 / cam.scale;
    const scene = (id: number | null) => (id === null ? undefined : this.ctx.bodyById.get(id));
    const placed = (id: number | null) => scene(id)?.placement;
    const around = (id: number | null, color: number, alpha: number) => {
      const found = scene(id);
      if (!found) return;
      const body = found.placement;
      const r = drawnDisc(body.disc, cam.scale, found.look) + SELECTED_GAP_PX * px;
      g.circle(body.x, body.y, r).stroke({ color, alpha, width: TARGET_WIDTH_PX * px });
    };
    if (drag?.ghost) {
      const { x, y, disc } = drag.ghost;
      g.circle(x, y, drawnDisc(disc, cam.scale, scene(drag.body)?.look)).fill({
        color: HOVER_COLOR,
        alpha: GHOST_ALPHA / 2,
      });
    }
    const ring = placed(drag?.body ?? null)?.ring;
    if (drag && ring) {
      const width = TARGET_WIDTH_PX * px;
      if (drag.tone === "shared" || drag.tone === "overlap") {
        const color = drag.tone === "overlap" ? CAUTION_COLOR : ACCENT_COLOR;
        g.circle(ring.cx, ring.cy, ring.radius).stroke({ color, width });
      } else {
        dashedCircle(g, ring.cx, ring.cy, ring.radius, ringDashes(ring.radius, cam.scale));
        g.stroke({ color: ACCENT_COLOR, alpha: OWN_RING_ALPHA, width });
      }
    }
    if (drag?.tone === "shared") around(drag.other, ACCENT_COLOR, SOFT_ALPHA);
    if (drag?.tone === "overlap") around(drag.other, CAUTION_COLOR, 1);
    if (drag?.tone === "refused") around(drag.other, REFUSED_COLOR, 1);
    around(drag?.host ?? null, ACCENT_COLOR, 1);
    const held = drag?.handle ?? this.hoveredHandle;
    const handles = held ? this.ctx.handles.filter((h) => sameHandle(h.ref, held)) : [];
    for (const handle of handles) {
      g.circle(handle.x, handle.y, (HANDLE_RADIUS_PX + HANDLE_GROW_PX) * px)
        .fill({ color: ACCENT_COLOR, alpha: SOFT_ALPHA })
        .stroke({ color: ACCENT_COLOR, width: TARGET_WIDTH_PX * px });
    }
  }

  /** The moons of `planets` that are not among them, which move with their planet. */
  private movingMoons(planets: readonly number[]): number[] {
    if (planets.length === 0) return [];
    const moving = new Set(planets);
    return this.ctx.bodies.flatMap(({ placement: { id, moon, parent } }) =>
      moon && parent !== null && moving.has(parent) && !moving.has(id) ? [id] : [],
    );
  }

  /** A dashed outline round each cut body and each moon that goes with it; returns them all. */
  private drawCut(cam: Camera): ReadonlySet<number> {
    const g = this.cutRings.clear();
    const cut = new Set([...this.ref.cutBodies, ...this.movingMoons(this.ref.cutBodies)]);
    const px = 1 / cam.scale;
    for (const id of cut) {
      const found = this.ctx.bodyById.get(id);
      if (!found) continue;
      const body = found.placement;
      const r = drawnDisc(body.disc, cam.scale, found.look) + SELECTED_GAP_PX * px;
      dashedCircle(g, body.x, body.y, r, CUT_DASHES);
    }
    if (cut.size > 0) g.stroke({ color: CUT_COLOR, alpha: CUT_ALPHA, width: RING_WIDTH_PX * px });
    return cut;
  }

  /** The orbit a lone cut planet would be pasted on, dashed, and its faint disc where it lands. */
  private drawPasteGhost(cam: Camera, ghost: PasteGhost | null): void {
    const g = this.pasteGhost.clear();
    if (!ghost) return;
    const width = TARGET_WIDTH_PX / cam.scale;
    dashedCircle(g, 0, 0, ghost.radius, ringDashes(ghost.radius, cam.scale));
    g.stroke({ color: ACCENT_COLOR, alpha: PASTE_RING_ALPHA, width });
    g.circle(ghost.x, ghost.y, drawnDisc(ghost.disc, cam.scale))
      .fill({ color: HOVER_COLOR, alpha: GHOST_ALPHA / 2 })
      .stroke({ color: ACCENT_COLOR, alpha: PASTE_RING_ALPHA, width });
  }

  /** The stretch of radii the selected scenario body's orbit may be rolled within. */
  private drawBand(body: SceneBody | undefined): void {
    const band = this.band.clear();
    const ring = body?.placement.ring;
    const range = body?.placement.band;
    if (!ring || !range) return;
    band.circle(ring.cx, ring.cy, range.outer).fill({ color: ACCENT_COLOR, alpha: BAND_ALPHA });
    if (range.inner > 0) band.circle(ring.cx, ring.cy, range.inner).cut();
  }

  private stand(tag: RadiusTag, cam: Camera, id: number, sx: number, sy: number): void {
    const k = plateScaleAt(cam, this.ctx.layout.fitRadius);
    standTag(tag, cam, tagBox(id, tag, sx, sy, k), k);
  }

  /** The plate in `slot` reading `text`, hidden until it is stood. */
  private tagFor(slot: TagSlot, text: string | null): RadiusTag | null {
    return this.tags.get(slot, text, slot);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
