import { Container, Graphics } from "pixi.js";
import { fitScale, polar, turnText } from "../../../lib/details/orbits";
import { ACCENT_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
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

type TagSlot = "radius" | "turn";

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * The hover ring, the selection ring and the highlighted lane's arrow, and a line from what the
 * selected body orbits out to it, labelled with its radius. A scenario body's turn from the body
 * before it shows as two rays from its ring's centre with the stretch of ring between them lit.
 */
export class HighlightLayer implements SystemLayer {
  readonly id = "highlight" as const;
  readonly container = new Container();
  private readonly g = new Graphics();
  readonly radiusLine = new Graphics();
  readonly turnRayMin = new Graphics();
  readonly turnRayMax = new Graphics();
  readonly turnArc = new Graphics();
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
    this.container.addChild(
      this.turnArc,
      this.turnRayMin,
      this.turnRayMax,
      this.radiusLine,
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
   * out to its selection ring, and its readout on a plate at the line's middle.
   */
  private drawRadius(cam: Camera, body: SceneBody | undefined): void {
    const line = this.radiusLine.clear();
    const tag = this.tagFor("radius", body?.readout?.text ?? null);
    const ring = body?.placement.ring;
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
    line
      .moveTo(ring.cx + ux * from, ring.cy + uy * from)
      .lineTo(ring.cx + ux * to, ring.cy + uy * to)
      .stroke({ color: ACCENT_COLOR, alpha: RADIUS_LINE_ALPHA, pixelLine: true });
    const middle = (from + to) / 2;
    const at = cam.worldToScreen(ring.cx + ux * middle, ring.cy + uy * middle);
    this.stand(tag, cam, body.placement.id, at.x, at.y);
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
