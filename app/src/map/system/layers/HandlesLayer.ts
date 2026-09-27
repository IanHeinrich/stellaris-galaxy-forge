import { Container, Graphics } from "pixi.js";
import { HANDLE_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { sameHandle, type HandleRef } from "../bodyDrag";
import { EMPTY_SYSTEM_CONTEXT, type SceneHandle, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

/** A handle's ring, its fill and its stroke, in screen pixels. */
export const HANDLE_RADIUS_PX = 5;
const HANDLE_STROKE_PX = 1.5;
const HANDLE_STROKE_COLOR = 0xffffff;
const HANDLE_STROKE_ALPHA = 0.7;

/**
 * Small rings spaced round a belt's circle or the inner radius's, where they may be edited: only
 * those of the band the pointer is over, or of the one being dragged.
 */
export class HandlesLayer implements SystemLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private handles: readonly SceneHandle[] = EMPTY_SYSTEM_CONTEXT.handles;
  private dragged: HandleRef | null = null;
  private revealed: HandleRef | null = null;
  private scale = -1;

  constructor() {
    this.container.addChild(this.g);
  }

  rebuild(ctx: SystemContext): void {
    const dragged = ctx.drag?.handle ?? null;
    if (ctx.handles === this.handles && sameHandle(dragged, this.dragged)) return;
    this.handles = ctx.handles;
    this.dragged = dragged;
    this.redraw();
  }

  /** Shows the handles of the band the pointer is over, or none. */
  reveal(owner: HandleRef | null): void {
    if (sameHandle(owner, this.revealed)) return;
    this.revealed = owner;
    this.redraw();
  }

  /** The handles drawn: the dragged band's, or else the revealed one's. */
  shown(): SceneHandle[] {
    const owner = this.dragged ?? this.revealed;
    return owner === null ? [] : this.handles.filter((h) => sameHandle(h.ref, owner));
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
    for (const { x, y } of this.shown()) {
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
