import { Container, Graphics } from "pixi.js";
import type { Ring } from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { ringDashes, sameRing } from "../geometry";
import type { SystemLayer } from "./SystemLayer";

const ORBIT_COLOR = 0x7f8fa6;
const ORBIT_ALPHA = 0.14;
const INNER_ALPHA = 0.3;
/** A ranged orbit's band, fainter than an orbit. */
const BAND_ALPHA = 0.05;

/**
 * Each body's orbit as a faint circle about its parent, and the system's border at the inner
 * radius dashed. A scenario body's ranged orbit is a faint band between its two radii. No ring
 * is stroked twice.
 */
export class OrbitsLayer implements SystemLayer {
  readonly id = "orbits" as const;
  readonly container = new Container();
  readonly rings = new Graphics();
  readonly inner = new Graphics();
  readonly bands = new Graphics();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private drawnScale = -1;

  constructor() {
    this.container.addChild(this.bands, this.inner, this.rings);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.layout === this.ctx.layout) return;
    this.ctx = ctx;
    this.drawnScale = -1;
    this.bands.clear();
    for (const { ring, band } of ctx.layout.bodies) {
      if (!ring || !band) continue;
      this.bands
        .circle(ring.cx, ring.cy, band.outer)
        .fill({ color: ORBIT_COLOR, alpha: BAND_ALPHA });
      if (band.inner > 0) this.bands.circle(ring.cx, ring.cy, band.inner).cut();
    }
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.drawnScale) return;
    this.drawnScale = cam.scale;
    const { layout } = this.ctx;
    this.rings.clear();
    const rings = this.distinctRings(1 / cam.scale);
    for (const { cx, cy, radius } of rings) this.rings.circle(cx, cy, radius);
    if (rings.length > 0) {
      this.rings.stroke({ color: ORBIT_COLOR, alpha: ORBIT_ALPHA, pixelLine: true });
    }
    this.inner.clear();
    const r = layout.innerRadius;
    dashedCircle(this.inner, 0, 0, r, ringDashes(r, cam.scale), 0.4);
    this.inner.stroke({ color: ORBIT_COLOR, alpha: INNER_ALPHA, pixelLine: true });
  }

  /**
   * Each ring once. The save's orbits on one ring differ by a fraction of a unit, so rings within
   * `px` are one.
   */
  private distinctRings(px: number): Ring[] {
    const rings: Ring[] = [];
    for (const { ring } of this.ctx.layout.bodies) {
      if (ring && !rings.some((other) => sameRing(ring, other, px))) rings.push(ring);
    }
    return rings;
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
