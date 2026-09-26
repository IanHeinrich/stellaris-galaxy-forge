import { Container } from "pixi.js";
import {
  fitScale,
  spanText,
  type BodyPlacement,
  type Ring,
  type Span,
} from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { drawnDisc, sameRing } from "../geometry";
import { overlaps, plateScale, type LabelBox } from "./labelSlots";
import { radiusTag, standTag, tagBox, type RadiusTag } from "./radiusTag";
import type { SystemLayer } from "./SystemLayer";

/** Where on its ring each label stands: 60° above the horizontal, to the right. */
const LABEL_ANGLE = -Math.PI / 3;
/** How far either way round its ring a label may slide off a body's disc, and in what steps. */
const SLIDE_MAX = Math.PI / 2;
const SLIDE_STEP = Math.PI / 36;
/** The on-screen radius under which a moon's ring is too small for a label to read against. */
const MOON_RING_MIN_PX = 40;

/** One drawn ring: the first body on it, and the radii of every body on it. */
interface RingGroup {
  readonly id: number;
  readonly ring: Ring;
  readonly moon: boolean;
  span: Span;
}

/** A body's disc on screen. */
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
function rank(a: RingGroup, b: RingGroup): number {
  if (a.moon !== b.moon) return a.moon ? 1 : -1;
  return a.moon ? b.ring.radius - a.ring.radius : a.ring.radius - b.ring.radius;
}

/**
 * Each drawn ring's radius on a small plate, all at one screen angle, while the Orbit radii
 * layer is on. Rings the orbits layer draws as one take one label, reading every radius on them;
 * a moon's takes one only once it is large enough on screen. A label that would cover a body's
 * disc or one already placed slides round its ring to the nearest clear spot, and is left out
 * when none is near.
 */
export class RadiiLayer implements SystemLayer {
  readonly id = "radii" as const;
  readonly container = new Container();
  private bodies = EMPTY_SYSTEM_CONTEXT.bodies;
  private shown = EMPTY_SYSTEM_CONTEXT.radiiShown;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  /** The bodies with a ring, in the order the orbits layer merges them. */
  private ringed: BodyPlacement[] = [];
  /** Every body, whose disc a label keeps off. */
  private placements: BodyPlacement[] = [];
  private moons = new Set<number>();
  /** Each shown ring's plate, by the ring's first body, with the text it reads. */
  private tags = new Map<number, { text: string; tag: RadiusTag }>();
  private cam: Camera | null = null;
  private drawnRev = -1;

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies && ctx.radiiShown === this.shown) return;
    this.bodies = ctx.bodies;
    this.shown = ctx.radiiShown;
    this.fitRadius = ctx.layout.fitRadius;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.tags.clear();
    const drawn = new Set(ctx.bodies.flatMap((b) => (b.readout ? [b.placement.id] : [])));
    this.ringed = ctx.radiiShown ? ctx.layout.bodies.filter((b) => drawn.has(b.id)) : [];
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

  /** The rings the orbits layer draws at `px` world units to the pixel, with their radii joined. */
  private groups(px: number): RingGroup[] {
    const groups: RingGroup[] = [];
    for (const { id, ring, radius } of this.ringed) {
      if (!ring || !radius) continue;
      const group = groups.find((other) => sameRing(ring, other.ring, px));
      if (group) {
        group.span = {
          min: Math.min(group.span.min, radius.min),
          max: Math.max(group.span.max, radius.max),
        };
      } else {
        groups.push({ id, ring, moon: this.moons.has(id), span: radius });
      }
    }
    return groups.sort(rank);
  }

  /** The plate for the ring of body `id` reading `text`, made again only when the text moves. */
  private tagFor(id: number, text: string): RadiusTag {
    const known = this.tags.get(id);
    if (known?.text === text) return known.tag;
    known?.tag.holder.destroy({ children: true });
    const tag = radiusTag(text);
    tag.holder.visible = false;
    this.container.addChild(tag.holder);
    this.tags.set(id, { text, tag });
    return tag;
  }

  private place(): void {
    const cam = this.cam;
    if (!cam) return;
    this.drawnRev = cam.rev;
    for (const { tag } of this.tags.values()) tag.holder.visible = false;
    const k = plateScale(cam.scale / fitScale(this.fitRadius, cam.width, cam.height));
    const placed: LabelBox[] = [];
    const discs: Disc[] = this.placements.map(({ x, y, disc }) => {
      const at = cam.worldToScreen(x, y);
      return { x: at.x, y: at.y, r: drawnDisc(disc, cam.scale) * cam.scale };
    });
    const clear = (box: LabelBox) =>
      !placed.some((other) => overlaps(box, other)) && !discs.some((disc) => covers(box, disc));
    for (const { id, ring, moon, span } of this.groups(1 / cam.scale)) {
      const r = ring.radius * cam.scale;
      if (moon && r < MOON_RING_MIN_PX) continue;
      const tag = this.tagFor(id, spanText(span));
      const centre = cam.worldToScreen(ring.cx, ring.cy);
      const at = (a: number) =>
        tagBox(id, tag, centre.x + r * Math.cos(a), centre.y + r * Math.sin(a), k);
      const box = SLIDES.map((off) => at(LABEL_ANGLE + off)).find(clear);
      if (!box) continue;
      placed.push(box);
      standTag(tag, cam, box, k);
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
