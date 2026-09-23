import { Container, Graphics } from "pixi.js";
import { toRing } from "../../../lib/feLinks";
import {
  FE_DIRECTIONS,
  FE_ZONE_DISTANCES,
  FE_ZONE_RADIUS,
  feZoneCentre,
} from "../../../lib/feZone";
import { REFUSED_COLOR } from "../../../lib/visual/style";
import type { FeZonePreview } from "../../feZonePreview";
import { dashedCircle } from "./dashedCircle";

/** The dashed ring a zone drag proposes: the zones' own hue, or the refusal's where it cannot go. */
const RING = { color: 0xf0abfc, alpha: 0.9 };
const RING_BLOCKED = { color: REFUSED_COLOR, alpha: 0.9 };
const RING_DASHES = 32;
/** The grid a zone drag chooses from, under the ghost ring: faint rays and one dot per slot. */
const RAY = { color: RING.color, alpha: 0.15 };
const RAY_LENGTH = FE_ZONE_DISTANCES[FE_ZONE_DISTANCES.length - 1];
const DOT = { color: RING.color, alpha: 0.35, radiusPx: 2.5 };
const DOT_BLOCKED = { color: RING_BLOCKED.color, alpha: 0.35, radiusPx: 2.5 };
const SNAPPED_RADIUS_PX = 4.5;

/** The ring a fallen empire zone drag proposes, over the grid of slots it chooses from. */
export class FeZoneDragOverlay {
  readonly container = new Container({ label: "feZoneDrag" });
  private readonly grid = new Graphics({ label: "feZoneGrid" });
  private readonly ring = new Graphics({ label: "feZoneRing" });
  private zone: FeZonePreview | null = null;
  private camScale = 1;

  constructor() {
    this.container.addChild(this.grid, this.ring);
  }

  get preview(): FeZonePreview | null {
    return this.zone;
  }

  set(preview: FeZonePreview | null): void {
    this.zone = preview;
    this.drawRing();
    this.drawGrid();
  }

  /** The grid's dots keep their size in screen pixels. */
  onScale(camScale: number): void {
    if (camScale === this.camScale) return;
    this.camScale = camScale;
    this.drawGrid();
  }

  private drawRing(): void {
    const g = this.ring;
    g.clear();
    const z = this.zone;
    if (!z) return;
    dashedCircle(g, z.x, z.y, FE_ZONE_RADIUS, RING_DASHES);
    const tie = toRing(z.anchor, z);
    if (tie) g.moveTo(tie.a.x, tie.a.y).lineTo(tie.b.x, tie.b.y);
    g.stroke({ ...(z.blocked || z.offMap ? RING_BLOCKED : RING), pixelLine: true });
  }

  /**
   * Eight faint rays to distance 200, a faint dot at every clear slot, a faint hollow circle at
   * every blocked one, and the snapped slot as a brighter, slightly larger dot.
   */
  private drawGrid(): void {
    const g = this.grid;
    g.clear();
    const z = this.zone;
    if (!z) return;
    for (const { key: direction } of FE_DIRECTIONS) {
      const tip = feZoneCentre(z.anchor, { direction, distance: RAY_LENGTH });
      g.moveTo(z.anchor.x, z.anchor.y).lineTo(tip.x, tip.y);
    }
    g.stroke({ ...RAY, pixelLine: true });
    const dotRadius = DOT.radiusPx / this.camScale;
    for (const slot of z.slots) {
      if (slot.direction === z.direction && slot.distance === z.distance) continue;
      if (slot.clear) {
        g.circle(slot.x, slot.y, dotRadius).fill({ color: DOT.color, alpha: DOT.alpha });
      } else {
        g.circle(slot.x, slot.y, dotRadius).stroke({
          color: DOT_BLOCKED.color,
          alpha: DOT_BLOCKED.alpha,
          pixelLine: true,
        });
      }
    }
    const snapped = z.blocked || z.offMap ? RING_BLOCKED : RING;
    g.circle(z.x, z.y, SNAPPED_RADIUS_PX / this.camScale).fill({
      color: snapped.color,
      alpha: snapped.alpha,
    });
  }
}
