import { Graphics } from "pixi.js";
import { toRing } from "../../../lib/feLinks";
import { FE_ZONE_RADIUS, feZoneCentre } from "../../../lib/feZone";
import type { Pt } from "../../../lib/geometry/pt";
import type { Segment } from "../../../lib/geometry/segments";
import { ALLOWED_COLOR, REFUSED_COLOR, RING_RADIUS } from "../../../lib/visual/style";
import type { LaneSource, LaneTarget } from "../../interaction/MapIntent";
import { PORT_INNER, PORT_OUTER, ringPortOffsetPx } from "../../picking/zones";
import type { Systems } from "../../RenderContext";
import { dashedCircle } from "../dashes";

const TARGET_VALID = { color: ALLOWED_COLOR, radius: RING_RADIUS.target, width: 2, alpha: 0.9 };
const TARGET_INVALID = { color: REFUSED_COLOR, radius: RING_RADIUS.target, width: 2, alpha: 0.9 };
/** How far outside a targeted zone's ring its target ring is drawn, in screen pixels. */
const FE_ZONE_TARGET_MARGIN_PX = 14;
const PORT_RING = { color: ALLOWED_COLOR, alpha: 0.45, hotAlpha: 1, width: 1.5, dashes: 16 };
/** A zone's port ring is longer than a star's, so it takes more dashes to read the same. */
const FE_ZONE_PORT_DASHES = 48;
const RUBBER_LANE = { color: ALLOWED_COLOR, alpha: 0.9 };

interface RubberLane {
  from: LaneSource;
  x: number;
  y: number;
  target: LaneTarget | null;
}

/**
 * What a lane or link being drawn shows: the port ring round the star or zone ring it can start
 * from, the rubber lines to the pointer or the snapped target, and the ring round that target.
 */
export class LaneDragOverlay {
  readonly port = new Graphics({ label: "port", alpha: PORT_RING.alpha });
  readonly target = new Graphics({ label: "target" });
  readonly lines = new Graphics({ label: "rubberLines" });
  private systems: Systems = new Map();
  private rubber: RubberLane | null = null;
  private hoverId: number | null = null;
  private hoverFeZone: number | null = null;
  private moving = false;
  private camScale = 1;
  private markerK = 1;
  private portCapable = false;

  setSystems(systems: Systems): void {
    this.systems = systems;
    this.redraw();
  }

  /** The zoom, the marker scale at it, and whether stars offer a port at it. */
  onScale(camScale: number, markerK: number, portCapable: boolean): void {
    this.camScale = camScale;
    this.markerK = markerK;
    this.portCapable = portCapable;
    this.redraw();
  }

  /** The star under the pointer, whose port ring shows where stars offer one. */
  setHover(id: number | null): void {
    this.hoverId = id;
    this.drawPort();
  }

  /** The zone whose ring or port band the pointer is on, by its anchor; its port ring shows. */
  setHoverFeZone(anchor: number | null): void {
    if (anchor === this.hoverFeZone) return;
    this.hoverFeZone = anchor;
    this.drawPort();
  }

  setPortHot(hot: boolean): void {
    this.port.alpha = hot ? PORT_RING.hotAlpha : PORT_RING.alpha;
  }

  /** Whether systems are being moved, which takes the port ring down. */
  setMoving(moving: boolean): void {
    this.moving = moving;
    this.drawPort();
  }

  setRubber(rubber: RubberLane | null): void {
    this.rubber = rubber;
    this.redraw();
  }

  private redraw(): void {
    this.drawPort();
    this.drawTarget();
    this.drawLines();
  }

  /** The centre of the ring `anchor` anchors, or undefined when it anchors none. */
  private zoneCentre(anchor: number): Pt | undefined {
    const s = this.systems.get(anchor);
    return s?.fe_zone ? feZoneCentre(s, s.fe_zone) : undefined;
  }

  /** A dashed ring in the middle of the port band: a star's in marker units, a zone's outside its ring band. */
  private drawPort(): void {
    const g = this.port;
    g.clear();
    if (this.rubber || this.moving) return;
    const zone = this.hoverFeZone === null ? undefined : this.zoneCentre(this.hoverFeZone);
    if (zone) {
      const r = FE_ZONE_RADIUS + ringPortOffsetPx(this.markerK) / this.camScale;
      dashedCircle(g, zone.x, zone.y, r, FE_ZONE_PORT_DASHES);
      g.stroke({ color: PORT_RING.color, width: PORT_RING.width / this.camScale });
      return;
    }
    const star =
      this.portCapable && this.hoverId !== null ? this.systems.get(this.hoverId) : undefined;
    if (!star) return;
    const r = (((PORT_INNER + PORT_OUTER) / 2) * this.markerK) / this.camScale;
    dashedCircle(g, star.x, star.y, r, PORT_RING.dashes);
    g.stroke({ color: PORT_RING.color, width: (PORT_RING.width * this.markerK) / this.camScale });
  }

  /** The snap target's ring: around a star at the marker radius, around a zone just outside its ring. */
  private drawTarget(): void {
    const g = this.target;
    g.clear();
    const t = this.rubber?.target;
    if (!t) return;
    const style = t.valid ? TARGET_VALID : TARGET_INVALID;
    const at = t.kind === "system" ? this.systems.get(t.id) : this.zoneCentre(t.anchor);
    if (!at) return;
    const radius =
      t.kind === "system"
        ? (style.radius * this.markerK) / this.camScale
        : FE_ZONE_RADIUS + FE_ZONE_TARGET_MARGIN_PX / this.camScale;
    g.circle(at.x, at.y, radius).stroke({
      color: style.color,
      alpha: style.alpha,
      width: (style.width * this.markerK) / this.camScale,
    });
  }

  private drawLines(): void {
    const g = this.lines;
    g.clear();
    const segments = this.segments();
    for (const { a, b } of segments) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (segments.length > 0) g.stroke({ ...RUBBER_LANE, pixelLine: true });
  }

  /**
   * The rubber lines of a pending lane or link: from each dragged system, or from the dragged
   * zone's ring, to the snapped system, the snapped ring's nearest point, or the pointer.
   */
  private segments(): Segment[] {
    const r = this.rubber;
    if (!r) return [];
    const target = r.target;
    const targetSystem = target?.kind === "system" ? this.systems.get(target.id) : undefined;
    const targetZone = target?.kind === "feZone" ? this.zoneCentre(target.anchor) : undefined;
    const end = targetSystem ?? { x: r.x, y: r.y };
    if (r.from.kind === "feZone") {
      const centre = this.zoneCentre(r.from.anchor);
      const segment = centre && toRing(end, centre);
      return segment ? [segment] : [];
    }
    const segments: Segment[] = [];
    for (const id of r.from.ids) {
      const from = this.systems.get(id);
      if (!from) continue;
      const segment = targetZone ? toRing(from, targetZone) : { a: from, b: end };
      if (segment) segments.push(segment);
    }
    return segments;
  }
}
