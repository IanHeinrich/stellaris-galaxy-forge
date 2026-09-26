import { Container, Graphics } from "pixi.js";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

const ORBIT_COLOR = 0x7f8fa6;
const ORBIT_ALPHA = 0.45;
const INNER_ALPHA = 0.2;
/** Screen pixels per dash step along a circle, and the fewest and most dashes a circle takes. */
const DASH_STEP_PX = 10;
const MIN_DASHES = 24;
const MAX_DASHES = 720;

function dashes(radius: number, scale: number): number {
  const steps = Math.round((2 * Math.PI * radius * scale) / DASH_STEP_PX);
  return Math.min(MAX_DASHES, Math.max(MIN_DASHES, steps));
}

/** Each body's orbit as a dashed circle about its parent, and the inner radius fainter at the edge. */
export class OrbitsLayer implements SystemLayer {
  readonly id = "orbits" as const;
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
    let any = false;
    for (const body of layout.bodies) {
      const ring = body.ring;
      if (!ring) continue;
      dashedCircle(this.rings, ring.cx, ring.cy, ring.radius, dashes(ring.radius, cam.scale));
      any = true;
    }
    if (any) this.rings.stroke({ color: ORBIT_COLOR, alpha: ORBIT_ALPHA, pixelLine: true });
    this.inner.clear();
    const r = layout.innerRadius;
    dashedCircle(this.inner, 0, 0, r, dashes(r, cam.scale), 0.4);
    this.inner.stroke({ color: ORBIT_COLOR, alpha: INNER_ALPHA, pixelLine: true });
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
