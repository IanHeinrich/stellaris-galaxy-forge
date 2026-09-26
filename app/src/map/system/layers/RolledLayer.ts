import { Container, Graphics } from "pixi.js";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { drawnDisc, ringDashes } from "../geometry";
import type { SystemLayer } from "./SystemLayer";

/** A pale grey-blue, with no class behind it. */
const ROLLED_COLOR = 0xcfd8e6;
/** The rings dotted and fainter than an orbit, and each planet a hollow disc with a faint wash. */
const RING_ALPHA = 0.1;
const RING_INK = 0.3;
const FILL_ALPHA = 0.06;
const EDGE_ALPHA = 0.35;

/**
 * The planets drawn for a system whose planets the game rolls: each a pale hollow disc on a
 * dotted ring, with no surface, icon or name.
 */
export class RolledLayer implements SystemLayer {
  readonly id = "rolled" as const;
  readonly container = new Container();
  readonly rings = new Graphics();
  readonly discs = new Graphics();
  private rolled = EMPTY_SYSTEM_CONTEXT.rolled;
  private scale = -1;

  constructor() {
    this.container.addChild(this.rings, this.discs);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.rolled === this.rolled) return;
    this.rolled = ctx.rolled;
    this.draw();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.draw();
  }

  private draw(): void {
    this.rings.clear();
    this.discs.clear();
    if (this.scale <= 0 || this.rolled.length === 0) return;
    for (const { ring } of this.rolled) {
      const { cx, cy, radius } = ring;
      dashedCircle(this.rings, cx, cy, radius, ringDashes(radius, this.scale), RING_INK);
    }
    this.rings.stroke({ color: ROLLED_COLOR, alpha: RING_ALPHA, pixelLine: true });
    for (const { x, y, disc } of this.rolled) {
      this.discs.circle(x, y, drawnDisc(disc, this.scale));
    }
    this.discs
      .fill({ color: ROLLED_COLOR, alpha: FILL_ALPHA })
      .stroke({ color: ROLLED_COLOR, alpha: EDGE_ALPHA, pixelLine: true });
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
