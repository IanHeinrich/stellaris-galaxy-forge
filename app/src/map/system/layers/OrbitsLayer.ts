import { Container, Graphics } from "pixi.js";
import type { Arc, BodyPlacement, Ring } from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { ringDashes, sameRing } from "../geometry";
import type { SystemLayer } from "./SystemLayer";

const ORBIT_COLOR = 0x7f8fa6;
const ORBIT_ALPHA = 0.14;
const INNER_ALPHA = 0.3;
/**
 * A ranged orbit's band, fainter than an orbit, and a ranged angle's arc: the stretch of the ring
 * it spans drawn a pixel wider at the ring's own strength, in place of the ring there.
 */
const BAND_ALPHA = 0.05;
const ARC_ALPHA = ORBIT_ALPHA;
const ARC_WIDTH_PX = 2;
const WHOLE_TURN: Arc = { from: 0, to: 360 };

/** The angles a body may stand at on its ring: its arc, or the whole ring for a ghost. */
function arcOf(body: BodyPlacement): Arc | null {
  return body.arc ?? (body.ghost ? WHOLE_TURN : null);
}

/** A ring and the arcs its bodies may stand on along it. */
interface RingArcs {
  ring: Ring;
  arcs: Arc[];
}

/**
 * The stretches of a turn that `arcs` cover, merged and within [0, 360), in order; one whole turn
 * when any spans a turn or more.
 */
function covered(arcs: readonly Arc[]): Arc[] {
  const spans: Arc[] = [];
  for (const { from, to } of arcs) {
    if (to - from >= 360) return [WHOLE_TURN];
    const start = ((from % 360) + 360) % 360;
    const end = start + (to - from);
    if (end <= 360) spans.push({ from: start, to: end });
    else spans.push({ from: start, to: 360 }, { from: 0, to: end - 360 });
  }
  spans.sort((a, b) => a.from - b.from);
  const merged: Arc[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** The stretches of a turn between `spans`, which `covered` gives. */
function gaps(spans: readonly Arc[]): Arc[] {
  if (spans.length === 0) return [WHOLE_TURN];
  const out: Arc[] = [];
  spans.forEach((span, i) => {
    const next = spans[(i + 1) % spans.length];
    const to = i + 1 < spans.length ? next.from : next.from + 360;
    if (to > span.to) out.push({ from: span.to, to });
  });
  return out;
}

function traceArc(g: Graphics, ring: Ring, arc: Arc): void {
  if (arc.to - arc.from >= 360) {
    g.circle(ring.cx, ring.cy, ring.radius);
    return;
  }
  const from = radians(arc.from);
  g.moveTo(ring.cx + ring.radius * Math.cos(from), ring.cy + ring.radius * Math.sin(from)).arc(
    ring.cx,
    ring.cy,
    ring.radius,
    from,
    radians(arc.to),
  );
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Each body's orbit as a faint circle about its parent, and the system's border at the inner
 * radius dashed. A scenario body's ranged orbit is a faint band between its two radii. Its ranged
 * angle is the stretch of its ring it spans drawn a pixel wider, and a body with no angle has its
 * whole ring drawn so. No stretch of a ring is stroked twice.
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
    this.arcs.clear();
    let ringed = false;
    let arced = false;
    for (const { ring, arcs } of this.ringArcs(1 / cam.scale)) {
      const spans = covered(arcs);
      const open = gaps(spans);
      for (const span of spans) traceArc(this.arcs, ring, span);
      for (const gap of open) traceArc(this.rings, ring, gap);
      arced ||= spans.length > 0;
      ringed ||= open.length > 0;
    }
    if (ringed) this.rings.stroke({ color: ORBIT_COLOR, alpha: ORBIT_ALPHA, pixelLine: true });
    if (arced) {
      this.arcs.stroke({ color: ORBIT_COLOR, alpha: ARC_ALPHA, width: ARC_WIDTH_PX / cam.scale });
    }
    this.inner.clear();
    const r = layout.innerRadius;
    dashedCircle(this.inner, 0, 0, r, ringDashes(r, cam.scale), 0.4);
    this.inner.stroke({ color: ORBIT_COLOR, alpha: INNER_ALPHA, pixelLine: true });
  }

  /**
   * Each ring once, with the arcs of the bodies on it. The save's orbits on one ring differ by a
   * fraction of a unit, so rings within `px` are one.
   */
  private ringArcs(px: number): RingArcs[] {
    const rings: RingArcs[] = [];
    for (const body of this.ctx.layout.bodies) {
      const { ring } = body;
      if (!ring) continue;
      let entry = rings.find((other) => sameRing(ring, other.ring, px));
      if (!entry) rings.push((entry = { ring, arcs: [] }));
      const arc = arcOf(body);
      if (arc) entry.arcs.push(arc);
    }
    return rings;
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
