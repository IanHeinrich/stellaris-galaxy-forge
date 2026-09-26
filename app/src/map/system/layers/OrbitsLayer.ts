import { Container, Graphics } from "pixi.js";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { ringDashes, ringGroups } from "../geometry";
import type { SystemLayer } from "./SystemLayer";

const ORBIT_COLOR = 0x7f8fa6;
const ORBIT_ALPHA = 0.14;
const INNER_ALPHA = 0.3;
/** The share of the inner radius's dashed circle that is inked. */
const INNER_INK = 0.4;

/**
 * Each body's orbit as a faint circle about its parent, a scenario body's at its rolled radius,
 * and the system's border at the inner radius dashed. No ring is stroked twice.
 */
export class OrbitsLayer implements SystemLayer {
  readonly container = new Container();
  readonly rings = new Graphics();
  readonly inner = new Graphics();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private drawnScale = -1;

  constructor() {
    this.container.addChild(this.inner, this.rings);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.layout === this.ctx.layout) return;
    this.ctx = ctx;
    this.drawnScale = -1;
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.drawnScale) return;
    this.drawnScale = cam.scale;
    const { layout } = this.ctx;
    this.rings.clear();
    const rings = ringGroups(layout.bodies, 1 / cam.scale);
    for (const { ring } of rings) this.rings.circle(ring.cx, ring.cy, ring.radius);
    if (rings.length > 0) {
      this.rings.stroke({ color: ORBIT_COLOR, alpha: ORBIT_ALPHA, pixelLine: true });
    }
    this.inner.clear();
    const r = layout.innerRadius;
    dashedCircle(this.inner, 0, 0, r, ringDashes(r, cam.scale), INNER_INK);
    this.inner.stroke({ color: ORBIT_COLOR, alpha: INNER_ALPHA, pixelLine: true });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
