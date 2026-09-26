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
import { sameRing } from "../geometry";
import { overlaps, plateScale, type LabelBox } from "./labelSlots";
import { radiusTag, standTag, tagBox, type RadiusTag } from "./radiusTag";
import type { SystemLayer } from "./SystemLayer";

/** Where on its ring each label stands: 60° above the horizontal, to the right. */
const LABEL_ANGLE = -Math.PI / 3;
const LABEL_DX = Math.cos(LABEL_ANGLE);
const LABEL_DY = Math.sin(LABEL_ANGLE);
/** The on-screen radius under which a moon's ring is too small for a label to read against. */
const MOON_RING_MIN_PX = 40;

/** One drawn ring: the first body on it, and the radii of every body on it. */
interface RingGroup {
  readonly id: number;
  readonly ring: Ring;
  readonly moon: boolean;
  span: Span;
}

/** Planets' rings from the innermost out, then moons' from the largest. */
function rank(a: RingGroup, b: RingGroup): number {
  if (a.moon !== b.moon) return a.moon ? 1 : -1;
  return a.moon ? b.ring.radius - a.ring.radius : a.ring.radius - b.ring.radius;
}

/**
 * Each drawn ring's radius on a small plate, all at one screen angle, while the Orbit radii
 * layer is on. Rings the orbits layer draws as one take one label, reading every radius on them;
 * a moon's takes one only once it is large enough on screen, and a label that would cross one
 * already placed is left out.
 */
export class RadiiLayer implements SystemLayer {
  readonly id = "radii" as const;
  readonly container = new Container();
  private bodies = EMPTY_SYSTEM_CONTEXT.bodies;
  private shown = EMPTY_SYSTEM_CONTEXT.radiiShown;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  /** The bodies with a ring, in the order the orbits layer merges them. */
  private ringed: BodyPlacement[] = [];
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
    for (const { id, ring, moon, span } of this.groups(1 / cam.scale)) {
      const r = ring.radius * cam.scale;
      if (moon && r < MOON_RING_MIN_PX) continue;
      const tag = this.tagFor(id, spanText(span));
      const centre = cam.worldToScreen(ring.cx, ring.cy);
      const box = tagBox(id, tag, centre.x + r * LABEL_DX, centre.y + r * LABEL_DY, k);
      if (placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);
      standTag(tag, cam, box, k);
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
