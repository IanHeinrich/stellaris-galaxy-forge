import { Container, Graphics } from "pixi.js";
import { GHOST_ALPHA, WORMHOLE_COLOR } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { markerScale } from "../../layers/MapLayer";
import { EMPTY_SYSTEM_CONTEXT, type SceneWormhole, type SystemContext } from "../context";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";

/** The marker's ring and its width, in screen pixels before the marker factor. */
const RING_PX = 7;
const RING_WIDTH_PX = 2;
/** The dot at the marker's centre, in screen pixels before the marker factor. */
const CORE_PX = 2;
const NATURAL_ALPHA = 0.9;
/** A shroud tunnel or anything else that stays where it is. */
const LOCKED_ALPHA = 0.35;
/** The ring under the pointer grows by this many screen pixels. */
const HOVER_GROW_PX = 2;

/**
 * A ring at each of the system's wormholes, in the galaxy map's wormhole purple; a shroud tunnel's
 * is dimmer. A dragged wormhole's save point shows a faint ring.
 */
export class WormholesLayer implements SystemLayer {
  readonly container = new Container();
  readonly marks = new Graphics();
  private wormholes: readonly SceneWormhole[] = EMPTY_SYSTEM_CONTEXT.wormholes;
  private dragged: number | null = null;
  private hovered: number | null = NO_HIGHLIGHT.hoverWormhole;
  private scale = -1;

  constructor() {
    this.marks.label = "wormholes";
    this.container.addChild(this.marks);
  }

  rebuild(ctx: SystemContext): void {
    const dragged = ctx.drag?.wormhole ?? null;
    if (ctx.wormholes === this.wormholes && dragged === this.dragged) return;
    this.wormholes = ctx.wormholes;
    this.dragged = dragged;
    this.redraw();
  }

  setHighlighted(ref: SceneHighlight): void {
    if (ref.hoverWormhole === this.hovered) return;
    this.hovered = ref.hoverWormhole;
    this.redraw();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.redraw();
  }

  private redraw(): void {
    const g = this.marks.clear();
    if (this.scale <= 0) return;
    const px = markerScale(this.scale) / this.scale;
    for (const hole of this.wormholes) {
      const alpha = hole.natural ? NATURAL_ALPHA : LOCKED_ALPHA;
      if (hole.id === this.dragged) {
        g.circle(hole.saved.x, hole.saved.y, RING_PX * px).stroke({
          color: WORMHOLE_COLOR,
          alpha: GHOST_ALPHA * alpha,
          width: RING_WIDTH_PX * px,
        });
      }
      const grow = hole.id === this.hovered ? HOVER_GROW_PX : 0;
      g.circle(hole.x, hole.y, (RING_PX + grow) * px).stroke({
        color: WORMHOLE_COLOR,
        alpha,
        width: RING_WIDTH_PX * px,
      });
      g.circle(hole.x, hole.y, CORE_PX * px).fill({ color: WORMHOLE_COLOR, alpha });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
