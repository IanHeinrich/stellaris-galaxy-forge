import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { Pt } from "../../../lib/geometry/pt";
import { ORIGIN_ALPHA } from "../../../lib/visual/style";
import type { SystemNode } from "../../../generated/SystemNode";
import type { Systems } from "../../RenderContext";
import { destroyChildren } from "../destroyChildren";

/** One kind of ring: its colour, its radius in marker units, and its stroke. */
export interface RingSpec {
  color: number;
  radius: number;
  width: number;
  alpha: number;
  /** The part of the ring drawn, in radians as `arc` takes them; the whole ring without it. */
  arc?: { start: number; end: number };
}

function ringShape(spec: RingSpec): GraphicsContext {
  const shape = new GraphicsContext();
  const { arc, radius } = spec;
  if (arc) {
    shape
      .moveTo(radius * Math.cos(arc.start), radius * Math.sin(arc.start))
      .arc(0, 0, radius, arc.start, arc.end);
  } else {
    shape.circle(0, 0, radius);
  }
  return shape.stroke({ color: spec.color, width: spec.width, alpha: spec.alpha });
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
    this.shape = ringShape(spec);
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
    this.container.destroy({ children: true });
    this.shape.destroy();
  }
}

/** The rings one batch of `RingBatches` draws: their look and the points they go round. */
export interface WantedRings {
  spec: RingSpec;
  points: readonly Pt[];
}

/** `RingBatch`es by kind of ring, added to one container and kept in step with what is wanted. */
export class RingBatches {
  private readonly batches = new Map<string, RingBatch>();
  private readonly scale: Pt = { x: 1, y: 1 };

  constructor(
    private readonly parent: Container,
    private readonly labelPrefix: string,
  ) {}

  /** Destroys the batches `wanted` lacks, makes the ones it adds, and places every batch's points. */
  sync(wanted: ReadonlyMap<string, WantedRings>): void {
    for (const [key, batch] of this.batches) {
      if (wanted.has(key)) continue;
      batch.destroy();
      this.batches.delete(key);
    }
    for (const [key, { spec, points }] of wanted) this.batchFor(key, spec).place(points);
  }

  /** Places `points` alone, in the batch for `key` if there is one. */
  place(key: string, points: readonly Pt[]): void {
    this.batches.get(key)?.place(points);
  }

  setScale(scale: Pt): void {
    this.scale.x = scale.x;
    this.scale.y = scale.y;
    for (const batch of this.batches.values()) batch.setScale(scale);
  }

  destroy(): void {
    for (const batch of this.batches.values()) batch.destroy();
    this.batches.clear();
  }

  private batchFor(key: string, spec: RingSpec): RingBatch {
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new RingBatch(spec, `${this.labelPrefix}${key}`);
      batch.setScale(this.scale);
      this.batches.set(key, batch);
      this.parent.addChild(batch.container);
    }
    return batch;
  }
}

/** Where the systems of `ids` the map holds draw, as `at` says, skipping the rest. */
export function pointsOf(systems: Systems, ids: Iterable<number>, at: (s: SystemNode) => Pt): Pt[] {
  const points: Pt[] = [];
  for (const id of ids) {
    const s = systems.get(id);
    if (s) points.push(at(s));
  }
  return points;
}
