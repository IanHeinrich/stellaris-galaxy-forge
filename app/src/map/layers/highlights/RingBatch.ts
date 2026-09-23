import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { Pt } from "../../../lib/geometry/pt";
import { ORIGIN_ALPHA } from "../../../lib/visual/style";
import type { Systems } from "../../RenderContext";
import { destroyChildren } from "../destroyChildren";

/** One kind of ring: its colour, its radius in marker units, and its stroke. */
export interface RingSpec {
  color: number;
  radius: number;
  width: number;
  alpha: number;
}

/** Spare rings kept past what a placement needs before the rest are destroyed. */
const SPARE_RINGS = 256;

/**
 * Identical rings around any number of points, some of them dimmed: one shape shared by every
 * ring, so a zoom only rescales them and a placement only moves them.
 */
export class RingBatch {
  readonly container: Container;
  private readonly shape: GraphicsContext;
  private readonly rings: Graphics[] = [];
  private shown = 0;
  private readonly scale: Pt = { x: 1, y: 1 };

  constructor(spec: RingSpec, label: string) {
    this.container = new Container({ label });
    this.shape = new GraphicsContext()
      .circle(0, 0, spec.radius)
      .stroke({ color: spec.color, width: spec.width, alpha: spec.alpha });
  }

  place(bright: readonly Pt[], dimmed: readonly Pt[] = []): void {
    const count = bright.length + dimmed.length;
    while (this.rings.length < count) {
      const g = new Graphics(this.shape);
      this.rings.push(g);
      this.container.addChild(g);
    }
    for (let i = 0; i < count; i++) {
      const g = this.rings[i];
      const at = i < bright.length ? bright[i] : dimmed[i - bright.length];
      g.position.set(at.x, at.y);
      g.scale.set(this.scale.x, this.scale.y);
      g.alpha = i < bright.length ? 1 : ORIGIN_ALPHA;
      g.visible = true;
    }
    for (let i = count; i < this.shown; i++) this.rings[i].visible = false;
    this.shown = count;
    if (this.rings.length - count > SPARE_RINGS) {
      destroyChildren(this.container, new Set(this.rings.splice(count + SPARE_RINGS)));
    }
  }

  setScale(scale: Pt): void {
    if (scale.x === this.scale.x && scale.y === this.scale.y) return;
    this.scale.x = scale.x;
    this.scale.y = scale.y;
    for (let i = 0; i < this.shown; i++) this.rings[i].scale.set(scale.x, scale.y);
  }

  destroy(): void {
    this.shape.destroy();
  }
}

/** The systems of `ids` the map holds, skipping the rest. */
export function pointsOf(systems: Systems, ids: Iterable<number>): Pt[] {
  const points: Pt[] = [];
  for (const id of ids) {
    const s = systems.get(id);
    if (s) points.push(s);
  }
  return points;
}
