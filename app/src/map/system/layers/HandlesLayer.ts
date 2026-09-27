import { Container, Graphics } from "pixi.js";
import { HANDLE_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SceneHandle, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

/** A handle's ring, its fill and its stroke, in screen pixels. */
export const HANDLE_RADIUS_PX = 5;
const HANDLE_STROKE_PX = 1.5;
const HANDLE_STROKE_COLOR = 0xffffff;
const HANDLE_STROKE_ALPHA = 0.7;

/**
 * Four small rings on each belt's circle and on the inner radius's, at the top, right, bottom and
 * left, where they may be edited.
 */
export class HandlesLayer implements SystemLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private handles: readonly SceneHandle[] = EMPTY_SYSTEM_CONTEXT.handles;
  private scale = -1;

  constructor() {
    this.container.addChild(this.g);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.handles === this.handles) return;
    this.handles = ctx.handles;
    this.redraw();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.redraw();
  }

  private redraw(): void {
    const g = this.g.clear();
    if (this.scale <= 0) return;
    const px = 1 / this.scale;
    for (const { x, y } of this.handles) {
      g.circle(x, y, HANDLE_RADIUS_PX * px)
        .fill({ color: HANDLE_COLOR })
        .stroke({
          color: HANDLE_STROKE_COLOR,
          alpha: HANDLE_STROKE_ALPHA,
          width: HANDLE_STROKE_PX * px,
        });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
