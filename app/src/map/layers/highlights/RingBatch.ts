import { Container, Graphics, GraphicsContext } from "pixi.js";
import { FE_ZONE_RADIUS, feZoneCentre } from "../../../lib/feZone";
import type { Pt } from "../../../lib/geometry/pt";
import { ORIGIN_ALPHA } from "../../../lib/visual/style";
import type { SystemNode } from "../../../generated/SystemNode";
import type { Systems } from "../../RenderContext";
import { destroyChildren } from "../destroyChildren";
import { markerScale } from "../MapLayer";

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

/**
 * Where the marks round the systems of `ids` the map holds go: the centre of the fallen empire
 * zone a system anchors, else the system as `at` draws it.
 */
export function zoneMarksOf(
  systems: Systems,
  ids: Iterable<number>,
  at: (s: SystemNode) => Pt,
): { zones: Pt[]; points: Pt[] } {
  const zones: Pt[] = [];
  const points: Pt[] = [];
  for (const id of ids) {
    const s = systems.get(id);
    if (!s) continue;
    if (s.fe_zone) zones.push(feZoneCentre(s, s.fe_zone));
    else points.push(at(s));
  }
  return { zones, points };
}

/** How far outside a zone's own ring its mark sits, in marker units. */
const ZONE_MARK_GAP = 4;

/**
 * Rings just outside fallen empire zones' own rings: sized in world units to keep to the zone at
 * any zoom, stroked as wide on screen as a `RingBatch` ring of the same spec.
 */
export class ZoneMarks {
  readonly graphics: Graphics;
  private centres: readonly Pt[] = [];
  private camScale = 1;

  constructor(
    private readonly spec: Pick<RingSpec, "color" | "width" | "alpha">,
    label: string,
  ) {
    this.graphics = new Graphics({ label });
  }

  place(centres: readonly Pt[]): void {
    this.centres = centres;
    this.draw();
  }

  setCamScale(camScale: number): void {
    if (camScale === this.camScale) return;
    this.camScale = camScale;
    if (this.centres.length > 0) this.draw();
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    if (this.centres.length === 0) return;
    const unit = markerScale(this.camScale) / this.camScale;
    const radius = FE_ZONE_RADIUS + ZONE_MARK_GAP * unit;
    for (const c of this.centres) g.circle(c.x, c.y, radius);
    g.stroke({ color: this.spec.color, width: this.spec.width * unit, alpha: this.spec.alpha });
  }
}
