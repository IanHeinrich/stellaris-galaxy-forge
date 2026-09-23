import { Circle, Container, type FederatedPointerEvent, Graphics } from "pixi.js";
import type { BypassLink } from "../../generated/BypassLink";
import type { Camera } from "../Camera";
import { type BypassKinds, bypassIconKey } from "../../lib/details/icons";
import { lgateOutcomeLine } from "../../lib/lgate";
import { titleCase } from "../../lib/text";
import { labelTier } from "../../lib/visual/labels";
import { badgeGeometry, badgeSide } from "../../lib/visual/specialStyle";
import { useLGateStore } from "../../store/lgateStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { Badge, badgeTexture, badgeTextStyle, otherSide, RING_RADIUS } from "./badge";
import { markerScale, type MapLayer } from "./MapLayer";

const WORMHOLE = { color: 0xc084fc, alpha: 0.8, dash: 5, gap: 4 };
const GATEWAY = { color: 0x38bdf8, icon: "gateway", label: "Gateway", ruined: "Ruined gateway" };
const LGATE = { color: 0x22d3ee, icon: "lgate", label: "L-Gate" };
const OTHER = { color: 0xa3e635, size: 3.5, width: 1.5, alpha: 0.85 };
/** Marker centre relative to the star, in marker units, so it clears the star and its rings. */
const OFFSET = { x: 12, y: -12 };
/** The marker's own hit area, around its offset centre, clear of the star's own hover and drag. */
const HIT = new Circle(OFFSET.x, OFFSET.y, OTHER.size + 2.5);
/** What a wormhole endpoint's other end not being drawn means, whether it has none or is hidden. */
const WORMHOLE_ALONE_NOTE = "Its other end is not shown";

type Marker = Extract<BypassLink, { type: "other" }>;
type Badged = Extract<BypassLink, { type: "gateway" } | { type: "l_gate" }>;

interface BadgeStyle {
  color: number;
  label: string;
  icon: string | null;
  alpha: number;
}

function badgeStyle(link: Badged, kinds: BypassKinds): BadgeStyle {
  if (link.type === "l_gate") {
    return {
      color: LGATE.color,
      label: LGATE.label,
      icon: bypassIconKey(LGATE.icon, kinds),
      alpha: 1,
    };
  }
  return {
    color: GATEWAY.color,
    label: link.active ? GATEWAY.label : GATEWAY.ruined,
    icon: bypassIconKey(GATEWAY.icon, kinds),
    alpha: 1,
  };
}

function drawMarker(g: Graphics): void {
  const { x, y } = OFFSET;
  const s = OTHER.size;
  g.clear()
    .rect(x - s, y - s, s * 2, s * 2)
    .stroke({ color: OTHER.color, width: OTHER.width, alpha: OTHER.alpha });
}

/** What a marker's tooltip calls its bypass: `common/bypass` carries no display name, so a
 * known kind is titled from its key, the same way the details row labels it. */
function markerName(kind: string): string {
  return kind === "wormhole" ? "Wormhole" : titleCase(kind.split("_").filter(Boolean)) || kind;
}

interface BadgeEntry {
  link: Badged;
  style: BadgeStyle;
  /** How many badges on this star come before it, so they stack instead of overlapping. */
  slot: number;
  badge: Badge;
}

/**
 * Wormhole pairs as dashed hairlines between their systems, a badge (ring on the star, plate
 * with icon and label beside it) on every gateway and L-Gate, and a screen-sized marker beside
 * every system with some other bypass. Both give way to the details row's own bypass icons once
 * that shows.
 */
export class BypassesLayer implements MapLayer {
  readonly id = "bypasses" as const;
  readonly container = new Container();
  private readonly lines = new Graphics({ label: "lines" });
  private readonly markerLayer = new Container({ label: "markers" });
  private readonly badgeLayer = new Container({ label: "badges" });
  private readonly markers: Array<{ link: Marker; g: Graphics }> = [];
  private readonly badges: BadgeEntry[] = [];
  private wormholes: Array<{ a: number; b: number }> = [];
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private bypasses = EMPTY_CONTEXT.bypasses;
  private bypassKinds = EMPTY_CONTEXT.bypassKinds;
  private nodeName = EMPTY_CONTEXT.nodeName;
  private readonly scale = { x: 1, y: 1 };
  private readonly badgeScale = { x: 1, y: 1 };
  private ringScale = 1;
  private tier = labelTier(0);
  private detailsShown = true;
  private hovered: Badged | null = null;
  private hoveredMarker: Marker | null = null;

  constructor() {
    this.container.addChild(this.lines, this.markerLayer, this.badgeLayer);
  }

  rebuild(ctx: RenderContext): void {
    const loaded =
      ctx.galaxy !== this.galaxy ||
      ctx.bypasses !== this.bypasses ||
      ctx.bypassKinds !== this.bypassKinds;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    this.nodeName = ctx.nodeName;
    if (!loaded) return;
    this.bypasses = ctx.bypasses;
    this.bypassKinds = ctx.bypassKinds;
    this.markerLayer.removeChildren().forEach((c) => c.destroy());
    this.badgeLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.markers.length = 0;
    this.badges.length = 0;
    this.hovered = null;
    this.hoveredMarker = null;
    this.wormholes = [];
    const slots = new Map<number, number>();
    for (const link of ctx.bypasses) {
      if (link.type === "wormhole") {
        this.wormholes.push({ a: link.a, b: link.b });
      } else if (link.type === "other") {
        this.markers.push({ link, g: this.makeMarker(link) });
      } else {
        const slot = slots.get(link.system) ?? 0;
        slots.set(link.system, slot + 1);
        this.badges.push({
          link,
          style: badgeStyle(link, this.bypassKinds),
          slot,
          badge: this.makeBadge(link),
        });
      }
    }
    this.placeMarkers();
    this.placeBadges();
    this.drawLines();
  }

  applyDelta(): void {
    this.placeMarkers();
    this.placeBadges();
    this.drawLines();
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const { g } of this.markers) g.scale.set(this.scale.x, this.scale.y);
    cam.childScale(1, this.badgeScale);
    this.ringScale = markerScale(cam.scale);
    for (const { badge } of this.badges) this.scaleBadge(badge);
    const tier = labelTier(cam.scale);
    if (tier !== this.tier) {
      this.tier = tier;
      this.showOverlays();
      this.placeBadges();
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  setDetailsShown(shown: boolean): void {
    this.detailsShown = shown;
    this.showOverlays();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  /** The small markers give way to the details row; a badge keeps its star at every zoom. */
  private showOverlays(): void {
    this.markerLayer.visible = !(this.detailsShown && this.tier !== "none");
    this.badgeLayer.visible = true;
  }

  private placeMarkers(): void {
    for (const { link, g } of this.markers) {
      const s = this.systems.get(link.system);
      g.visible = s !== undefined;
      if (s) g.position.set(s.x, s.y);
    }
  }

  private makeMarker(link: Marker): Graphics {
    const marker = new Graphics();
    drawMarker(marker);
    marker.scale.set(this.scale.x, this.scale.y);
    marker.eventMode = "static";
    marker.cursor = "help";
    marker.hitArea = HIT;
    marker.on("pointerover", (e: FederatedPointerEvent) => this.hoverMarker(link, e.global));
    marker.on("pointerout", () => this.unhoverMarker(link));
    this.markerLayer.addChild(marker);
    return marker;
  }

  private makeBadge(link: Badged): Badge {
    const badge = new Badge(badgeGeometry(this.tier));
    badge.plate.on("pointerover", (e: FederatedPointerEvent) => this.hover(link, e.global));
    badge.plate.on("pointerout", () => this.unhover(link));
    this.badgeLayer.addChild(badge.root);
    return badge;
  }

  private scaleBadge(badge: Badge): void {
    badge.root.scale.set(this.badgeScale.x, this.badgeScale.y);
    badge.ring.scale.set(this.ringScale);
  }

  private placeBadges(): void {
    const geo = badgeGeometry(this.tier);
    for (const { link, style, slot, badge } of this.badges) {
      const s = this.systems.get(link.system);
      badge.root.visible = s !== undefined;
      if (!s) continue;
      badge.root.position.set(s.x, s.y);
      badge.root.alpha = style.alpha;
      this.scaleBadge(badge);
      if (badge.text.style.fontSize !== geo.font) badge.text.style = badgeTextStyle(geo);
      if (badge.text.text !== style.label) badge.text.text = style.label;
      badge.setIcon(style.icon === null ? null : badgeTexture(style.icon), geo.icon, style.color);
      const side = otherSide(badgeSide(link.system, this.tier));
      badge.layout(geo, side, style.color, RING_RADIUS * this.ringScale, slot);
    }
  }

  private hover(link: Badged, at: { x: number; y: number }): void {
    const s = this.systems.get(link.system);
    if (!s) return;
    this.hovered = link;
    const lines = [this.nodeName(s.name)];
    const lgate = this.galaxy?.lgate;
    if (link.type === "l_gate" && lgate && useLGateStore.getState().revealed) {
      lines.push(lgateOutcomeLine(lgate));
    }
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: badgeStyle(link, this.bypassKinds).label,
      lines,
    });
  }

  private unhover(link: Badged): void {
    if (this.hovered !== link) return;
    this.hovered = null;
    useMapChromeStore.getState().hideTooltip();
  }

  private hoverMarker(link: Marker, at: { x: number; y: number }): void {
    const s = this.systems.get(link.system);
    if (!s) return;
    this.hoveredMarker = link;
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: markerName(link.kind),
      lines:
        link.kind === "wormhole"
          ? [WORMHOLE_ALONE_NOTE, this.nodeName(s.name)]
          : [this.nodeName(s.name)],
    });
  }

  private unhoverMarker(link: Marker): void {
    if (this.hoveredMarker !== link) return;
    this.hoveredMarker = null;
    useMapChromeStore.getState().hideTooltip();
  }

  private drawLines(): void {
    const g = this.lines;
    g.clear();
    let any = false;
    for (const { a, b } of this.wormholes) {
      const sa = this.systems.get(a);
      const sb = this.systems.get(b);
      if (!sa || !sb) continue;
      dashed(g, sa.x, sa.y, sb.x, sb.y);
      any = true;
    }
    if (any) g.stroke({ color: WORMHOLE.color, alpha: WORMHOLE.alpha, pixelLine: true });
  }
}

function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const period = WORMHOLE.dash + WORMHOLE.gap;
  for (let t = 0; t < len; t += period) {
    const end = Math.min(t + WORMHOLE.dash, len);
    g.moveTo(x0 + ux * t, y0 + uy * t).lineTo(x0 + ux * end, y0 + uy * end);
  }
}
