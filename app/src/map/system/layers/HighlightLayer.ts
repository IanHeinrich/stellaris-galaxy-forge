import { Container, Graphics } from "pixi.js";
import { fitScale, polar, stepText, turnText } from "../../../lib/details/orbits";
import { ACCENT_COLOR, MATCHED_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { dashedCircle, dashedLine } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import { drawnDisc, exitTriangle, SELECTED_GAP_PX, SELECTED_WIDTH_PX } from "../geometry";
import { plateScale } from "./labelSlots";
import { radiusTag, standTag, tagBox, type RadiusTag } from "./radiusTag";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

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

type TagSlot = "radius" | "turn" | "step";

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * The hover ring, the selection ring and the highlighted lane's arrow, and a line from what the
 * selected body orbits out to it, labelled with its radius. A scenario body's turn from the body
 * before it shows as two rays from its ring's centre with the stretch of ring between them lit.
 * What a scenario body is measured from is marked in a colour of its own: the body it turns from,
 * with a ray through it where the turn starts, and the orbit it steps out from, with the step's
 * stretch of the radius line labelled. Its ranged orbit shows as a faint band between its radii.
 */
export class HighlightLayer implements SystemLayer {
  readonly id = "highlight" as const;
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
  private readonly tags = new Map<TagSlot, { text: string; tag: RadiusTag }>();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private ref: SceneHighlight = NO_HIGHLIGHT;
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
    this.container.addChild(
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
    const selected = id === null ? undefined : this.ctx.bodies.find((b) => b.placement.id === id);
    this.drawRadius(cam, selected);
    this.drawTurn(cam, selected);
    this.drawAnchor(cam, selected);
    this.drawBand(selected);
    const px = 1 / cam.scale;
    const ring = (id: number | null, gap: number, width: number, color: number, alpha: number) => {
      const body = id === null ? undefined : this.ctx.bodies.find((b) => b.placement.id === id);
      if (!body) return;
      const { x, y, disc } = body.placement;
      g.circle(x, y, drawnDisc(disc, cam.scale) + gap * px).stroke({
        color,
        alpha,
        width: width * px,
      });
    };
    ring(this.ref.hoverBody, HOVER_GAP_PX, RING_WIDTH_PX, HOVER_COLOR, HOVER_ALPHA);
    ring(this.ref.selectedBody, SELECTED_GAP_PX, SELECTED_WIDTH_PX, ACCENT_COLOR, 1);
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
    const length = Math.hypot(x - ring.cx, y - ring.cy);
    const px = 1 / cam.scale;
    const hub = body.readout.hub;
    const from = hub > 0 ? drawnDisc(hub, cam.scale) + RADIUS_HUB_GAP_PX * px : 0;
    const to = length - drawnDisc(disc, cam.scale) - SELECTED_GAP_PX * px;
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
    if (to - from >= 360) {
      arc.circle(cx, cy, radius);
    } else {
      const start = radians(from);
      arc
        .moveTo(cx + radius * Math.cos(start), cy + radius * Math.sin(start))
        .arc(cx, cy, radius, start, radians(to));
      const hub = body.readout?.hub ?? 0;
      const near = hub > 0 ? drawnDisc(hub, cam.scale) + RADIUS_HUB_GAP_PX * px : 0;
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
    const anchor = this.ctx.bodies.find((b) => b.placement.id === turn.anchor);
    if (!anchor) return;
    const px = 1 / cam.scale;
    const { x, y, disc } = anchor.placement;
    const r = drawnDisc(disc, cam.scale) + SELECTED_GAP_PX * px;
    const linked = this.ref.linkedBody === turn.anchor;
    dashedCircle(outline, x, y, r, ANCHOR_DASHES);
    outline.stroke({
      color: BASE_COLOR,
      alpha: linked ? 1 : ANCHOR_ALPHA,
      width: (linked ? LINKED_ANCHOR_WIDTH_PX : ANCHOR_WIDTH_PX) * px,
    });
    const reach = Math.max(ring.radius, Math.hypot(x - ring.cx, y - ring.cy) + r);
    const hub = body.readout?.hub ?? 0;
    const near = hub > 0 ? drawnDisc(hub, cam.scale) + RADIUS_HUB_GAP_PX * px : 0;
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
    const k = plateScale(cam.scale / fitScale(this.ctx.layout.fitRadius, cam.width, cam.height));
    standTag(tag, cam, tagBox(id, tag, sx, sy, k), k);
  }

  /**
   * The plate in `slot` reading `text`, hidden until it is stood; made again only when the text
   * moves.
   */
  private tagFor(slot: TagSlot, text: string | null): RadiusTag | null {
    const held = this.tags.get(slot);
    if (held?.text !== text) {
      held?.tag.holder.destroy({ children: true });
      this.tags.delete(slot);
      if (text !== null) {
        const tag = radiusTag(text, slot);
        this.container.addChild(tag.holder);
        this.tags.set(slot, { text, tag });
      }
    }
    const tag = this.tags.get(slot)?.tag ?? null;
    if (tag) tag.holder.visible = false;
    return tag;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
