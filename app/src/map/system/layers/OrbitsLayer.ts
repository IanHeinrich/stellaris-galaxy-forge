import { Container, Graphics } from "pixi.js";
import type { Arc, BodyPlacement } from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

const ORBIT_COLOR = 0x7f8fa6;
const ORBIT_ALPHA = 0.45;
const INNER_ALPHA = 0.2;
/** A ranged orbit's band, and a ranged angle's arc, which stands out from the dashed ring under it. */
const BAND_ALPHA = 0.12;
const ARC_ALPHA = 0.85;
const ARC_WIDTH_PX = 2;
const WHOLE_TURN: Arc = { from: 0, to: 360 };
/** Screen pixels per dash step along a circle, and the fewest and most dashes a circle takes. */
const DASH_STEP_PX = 10;
const MIN_DASHES = 24;
const MAX_DASHES = 720;

function dashes(radius: number, scale: number): number {
  const steps = Math.round((2 * Math.PI * radius * scale) / DASH_STEP_PX);
  return Math.min(MAX_DASHES, Math.max(MIN_DASHES, steps));
}

/** The angles a body may stand at on its ring: its arc, or the whole ring for a ghost. */
function arcOf(body: BodyPlacement): Arc | null {
  return body.arc ?? (body.ghost ? WHOLE_TURN : null);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Each body's orbit as a dashed circle about its parent, and the inner radius fainter at the edge.
 * A scenario body's ranged orbit is a band between its two radii, and its ranged angle an arc.
 */
export class OrbitsLayer implements SystemLayer {
  readonly id = "orbits" as const;
  readonly container = new Container();
  readonly rings = new Graphics();
  readonly inner = new Graphics();
  readonly bands = new Graphics();
  readonly arcs = new Graphics();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private drawnScale = -1;

  constructor() {
    this.container.addChild(this.bands, this.inner, this.rings, this.arcs);
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
    let any = false;
    for (const body of layout.bodies) {
      const ring = body.ring;
      if (!ring) continue;
      dashedCircle(this.rings, ring.cx, ring.cy, ring.radius, dashes(ring.radius, cam.scale));
      any = true;
    }
    if (any) this.rings.stroke({ color: ORBIT_COLOR, alpha: ORBIT_ALPHA, pixelLine: true });
    this.drawArcs(cam.scale);
    this.inner.clear();
    const r = layout.innerRadius;
    dashedCircle(this.inner, 0, 0, r, dashes(r, cam.scale), 0.4);
    this.inner.stroke({ color: ORBIT_COLOR, alpha: INNER_ALPHA, pixelLine: true });
  }

  private drawArcs(scale: number): void {
    this.arcs.clear();
    let any = false;
    for (const body of this.ctx.layout.bodies) {
      const { ring } = body;
      const arc = arcOf(body);
      if (!ring || !arc) continue;
      const from = radians(arc.from);
      this.arcs
        .moveTo(ring.cx + ring.radius * Math.cos(from), ring.cy + ring.radius * Math.sin(from))
        .arc(ring.cx, ring.cy, ring.radius, from, radians(arc.to));
      any = true;
    }
    if (any) {
      this.arcs.stroke({ color: ORBIT_COLOR, alpha: ARC_ALPHA, width: ARC_WIDTH_PX / scale });
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
