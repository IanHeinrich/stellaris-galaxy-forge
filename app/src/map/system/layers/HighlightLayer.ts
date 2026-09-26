import { Container, Graphics } from "pixi.js";
import { ACCENT_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { drawnDisc, exitTriangle } from "../geometry";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

const HOVER_COLOR = 0xffffff;
const HOVER_ALPHA = 0.75;
/** Past the drawn disc, and the stroke width, in screen pixels. */
const HOVER_GAP_PX = 4;
const SELECTED_GAP_PX = 7;
const RING_WIDTH_PX = 1.5;
const SELECTED_WIDTH_PX = 2;
/** How much bigger the highlighted lane's arrow is drawn, in screen pixels. */
const LANE_GROW_PX = 3;

/** The hover ring, the selection ring and the highlighted lane's arrow. */
export class HighlightLayer implements SystemLayer {
  readonly id = "highlight" as const;
  readonly container = new Container();
  private readonly g = new Graphics();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private ref: SceneHighlight = NO_HIGHLIGHT;
  private cam: Camera | null = null;
  private drawnRev = -1;

  constructor() {
    this.container.addChild(this.g);
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

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
