import { Container } from "pixi.js";
import { fitScale, type Ring } from "../../../lib/details/orbits";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { sameRing } from "../geometry";
import { overlaps, plateScale, type LabelBox } from "./labelSlots";
import { radiusTag, standTag, tagBox, type RadiusTag } from "./radiusTag";
import type { SystemLayer } from "./SystemLayer";

/**
 * Where on its ring each label stands, in screen radians: up and to the right, a third of a turn
 * short of the right. Name plates hang under and over their bodies, so the column over the
 * centre is where a star's plate goes, and a scenario's bodies with no angle share their rings
 * out from the horizontal. Steep enough that the labels of rings a plate's height apart clear
 * each other.
 */
const LABEL_ANGLE = -Math.PI / 3;
const LABEL_DX = Math.cos(LABEL_ANGLE);
const LABEL_DY = Math.sin(LABEL_ANGLE);
/** The on-screen radius under which a moon's ring is too small for a label to read against. */
const MOON_RING_MIN_PX = 40;

/** A ring's label, for the first body on that ring. */
interface RingTag extends RadiusTag {
  readonly id: number;
  readonly ring: Ring;
  readonly moon: boolean;
}

/** Planets' rings from the innermost out, then moons' from the largest. */
function rank(a: RingTag, b: RingTag): number {
  if (a.moon !== b.moon) return a.moon ? 1 : -1;
  return a.moon ? b.ring.radius - a.ring.radius : a.ring.radius - b.ring.radius;
}

/**
 * Each drawn ring's radius on a small plate, all at one screen angle, while the Orbit radii
 * layer is on. Rings the orbits layer draws as one take one label; a moon's takes one only once
 * it is large enough on screen, and a label that would cross one already placed is left out.
 */
export class RadiiLayer implements SystemLayer {
  readonly id = "radii" as const;
  readonly container = new Container();
  private bodies = EMPTY_SYSTEM_CONTEXT.bodies;
  private shown = EMPTY_SYSTEM_CONTEXT.radiiShown;
  private fitRadius = EMPTY_SYSTEM_CONTEXT.layout.fitRadius;
  private tags: RingTag[] = [];
  private cam: Camera | null = null;
  private drawnRev = -1;

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies && ctx.radiiShown === this.shown) return;
    this.bodies = ctx.bodies;
    this.shown = ctx.radiiShown;
    this.fitRadius = ctx.layout.fitRadius;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.tags = !ctx.radiiShown
      ? []
      : ctx.bodies
          .flatMap((body) => {
            const { ring, id } = body.placement;
            if (!ring || !body.readout) return [];
            const tag = radiusTag(body.readout.ring);
            this.container.addChild(tag.holder);
            return [{ ...tag, id, ring, moon: body.moon }];
          })
          .sort(rank);
    this.drawnRev = -1;
    this.place();
  }

  onViewport(cam: Camera): void {
    this.cam = cam;
    if (cam.rev === this.drawnRev) return;
    this.place();
  }

  private boxOf(tag: RingTag, cam: Camera, k: number): LabelBox {
    const { cx, cy, radius } = tag.ring;
    const centre = cam.worldToScreen(cx, cy);
    const r = radius * cam.scale;
    return tagBox(tag.id, tag, centre.x + r * LABEL_DX, centre.y + r * LABEL_DY, k);
  }

  private place(): void {
    const cam = this.cam;
    if (!cam) return;
    this.drawnRev = cam.rev;
    const px = 1 / cam.scale;
    const k = plateScale(cam.scale / fitScale(this.fitRadius, cam.width, cam.height));
    const rings: Ring[] = [];
    const placed: LabelBox[] = [];
    for (const tag of this.tags) {
      tag.holder.visible = false;
      if (rings.some((ring) => sameRing(ring, tag.ring, px))) continue;
      rings.push(tag.ring);
      if (tag.moon && tag.ring.radius * cam.scale < MOON_RING_MIN_PX) continue;
      const box = this.boxOf(tag, cam, k);
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
