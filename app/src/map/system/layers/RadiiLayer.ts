import { Container } from "pixi.js";
import type { Bounds } from "../../../generated/Bounds";
import { boundsText } from "../../../lib/details/labels";
import type { BodyPlacement, Ring } from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { drawnDisc, ringGroups } from "../geometry";
import { overlaps, plateScaleAt, ringReach, type LabelBox } from "./labelSlots";
import { standTag, TagCache, tagBox } from "./plate";
import type { SystemLayer } from "./SystemLayer";

/** Where on its ring each label stands: 60° above the horizontal, to the right. */
const LABEL_ANGLE = -Math.PI / 3;
/** How far either way round its ring a label may slide off a body's disc, and in what steps. */
const SLIDE_MAX = Math.PI / 2;
const SLIDE_STEP = Math.PI / 36;
/** The on-screen radius under which a moon's ring is too small for a label to read against. */
const MOON_RING_MIN_PX = 40;

/** One drawn ring with a label: the first body on it, and the radii of every body on it. */
interface Labelled {
  readonly id: number;
  readonly ring: Ring;
  readonly moon: boolean;
  readonly span: Bounds;
}

/** A body's disc on screen, out to the ring a selection draws round it. */
interface Disc {
  x: number;
  y: number;
  r: number;
}

function covers(box: LabelBox, disc: Disc): boolean {
  const nx = Math.max(box.x, Math.min(disc.x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(disc.y, box.y + box.h));
  return Math.hypot(disc.x - nx, disc.y - ny) < disc.r;
}

/** The turns off the label's own angle to try, nearest first. */
function slides(): number[] {
  const out = [0];
  for (let off = SLIDE_STEP; off <= SLIDE_MAX + 1e-9; off += SLIDE_STEP) out.push(off, -off);
  return out;
}
const SLIDES = slides();

/** Planets' rings from the innermost out, then moons' from the largest. */
function rank(a: Labelled, b: Labelled): number {
  if (a.moon !== b.moon) return a.moon ? 1 : -1;
  return a.moon ? b.ring.radius - a.ring.radius : a.ring.radius - b.ring.radius;
}

/**
 * Each drawn ring's radius on a small plate, all at one screen angle, while the Orbit radii
 * layer is on. Rings the orbits layer draws as one take one label, reading every radius on them;
 * a moon's takes one only once it is large enough on screen. A label that would cover a body's
 * disc or its selection ring, or one already placed, slides round its ring to the nearest clear
 * spot, and is left out when none is near.
 */
export class RadiiLayer implements SystemLayer {
  readonly container = new Container();
  private bodies = EMPTY_SYSTEM_CONTEXT.bodies;
  private shown = EMPTY_SYSTEM_CONTEXT.sceneLayers.orbitRadii;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  /** The bodies with a readout, in layout order. */
  private ringed: BodyPlacement[] = [];
  /** Every body, whose disc a label keeps off. */
  private placements: BodyPlacement[] = [];
  private moons = new Set<number>();
  /** Each shown ring's plate, by the ring's first body. */
  private readonly tags = new TagCache<number>(this.container);
  private cam: Camera | null = null;
  private drawnRev = -1;

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies && ctx.sceneLayers.orbitRadii === this.shown) return;
    this.bodies = ctx.bodies;
    this.shown = ctx.sceneLayers.orbitRadii;
    this.fitRadius = ctx.layout.fitRadius;
    this.tags.clear();
    const drawn = new Set(ctx.bodies.flatMap((b) => (b.readout ? [b.placement.id] : [])));
    this.ringed = ctx.sceneLayers.orbitRadii
      ? ctx.layout.bodies.filter((b) => drawn.has(b.id))
      : [];
    this.moons = new Set(ctx.bodies.flatMap((b) => (b.moon ? [b.placement.id] : [])));
    this.placements = ctx.bodies.map((b) => b.placement);
    this.drawnRev = -1;
    this.place();
  }

  onViewport(cam: Camera): void {
    this.cam = cam;
    if (cam.rev === this.drawnRev) return;
    this.place();
  }

  /** The rings the orbits layer draws at `px` world units to the pixel, in the order they are labelled. */
  private groups(px: number): Labelled[] {
    return ringGroups(this.ringed, px)
      .map((group) => ({ ...group, moon: this.moons.has(group.id) }))
      .sort(rank);
  }

  private place(): void {
    const cam = this.cam;
    if (!cam) return;
    this.drawnRev = cam.rev;
    this.tags.hideAll();
    const k = plateScaleAt(cam, this.fitRadius);
    const placed: LabelBox[] = [];
    const discs: Disc[] = this.placements.map(({ x, y, disc }) => {
      const at = cam.worldToScreen(x, y);
      return { x: at.x, y: at.y, r: ringReach(drawnDisc(disc, cam.scale) * cam.scale) };
    });
    const clear = (box: LabelBox) =>
      !placed.some((other) => overlaps(box, other)) && !discs.some((disc) => covers(box, disc));
    for (const { id, ring, moon, span } of this.groups(1 / cam.scale)) {
      const r = ring.radius * cam.scale;
      if (moon && r < MOON_RING_MIN_PX) continue;
      const tag = this.tags.get(id, boundsText(span), "radius");
      if (!tag) continue;
      const centre = cam.worldToScreen(ring.cx, ring.cy);
      const at = (a: number) =>
        tagBox(id, tag, centre.x + r * Math.cos(a), centre.y + r * Math.sin(a), k);
      const box = SLIDES.map((off) => at(LABEL_ANGLE + off)).find(clear);
      if (!box) continue;
      placed.push(box);
      standTag(tag, cam, box, k);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
