import { Container, Graphics } from "pixi.js";
import { fitScale } from "../../../lib/details/orbits";
import { ACCENT_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
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
 * The hover ring, the selection ring and the highlighted lane's arrow, and a line from what the
 * selected body orbits out to it, labelled with its radius.
 */
export class HighlightLayer implements SystemLayer {
  readonly id = "highlight" as const;
  readonly container = new Container();
  private readonly g = new Graphics();
  readonly radiusLine = new Graphics();
  private readout: { text: string; tag: RadiusTag } | null = null;
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private ref: SceneHighlight = NO_HIGHLIGHT;
  private cam: Camera | null = null;
  private drawnRev = -1;

  constructor() {
    this.radiusLine.label = "radius-line";
    this.container.addChild(this.radiusLine, this.g);
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
    this.drawRadius(cam);
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
  private drawRadius(cam: Camera): void {
    const id = this.ref.selectedBody;
    const body = id === null ? undefined : this.ctx.bodies.find((b) => b.placement.id === id);
    const line = this.radiusLine.clear();
    const tag = this.tagFor(body?.readout?.line ?? null);
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
    const k = plateScale(cam.scale / fitScale(this.ctx.layout.fitRadius, cam.width, cam.height));
    standTag(tag, cam, tagBox(body.placement.id, tag, at.x, at.y, k), k);
  }

  /** The plate reading `text`, hidden until it is stood; made again only when the text moves. */
  private tagFor(text: string | null): RadiusTag | null {
    if (this.readout?.text !== text) {
      this.readout?.tag.holder.destroy({ children: true });
      this.readout = null;
      if (text !== null) {
        const tag = radiusTag(text);
        this.container.addChild(tag.holder);
        this.readout = { text, tag };
      }
    }
    const tag = this.readout?.tag ?? null;
    if (tag) tag.holder.visible = false;
    return tag;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
