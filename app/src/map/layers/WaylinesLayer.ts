import { Container, Graphics } from "pixi.js";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { Wayline } from "../../generated/Wayline";
import type { Waystation } from "../../generated/Waystation";
import { isWaystationLevel, starbaseLabel } from "../../lib/details/labels";
import { labelTier } from "../../lib/visual/labels";
import { badgeGeometry, badgeSide } from "../../lib/visual/specialStyle";
import { OwnedTooltip } from "../ownedTooltip";
import type { Camera } from "../Camera";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { Badge, BADGE_RING_RADIUS } from "./badge";
import { evenDashedLine } from "./dashes";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";
import { counted } from "../../lib/text";

/** The band the game lays over the lane: broad, translucent grey, its dashes twice their gaps. */
const BAND = { color: 0xd6dde3, alpha: 0.35, width: 3, dash: 6, gap: 3 };

/** The level a badge wears until the system's details say which one its station has reached. */
const UNREAD_LEVEL = "starbase_level_waystation_1";

const NO_DRAG: ReadonlyMap<number, MoveGhost> = new Map();
const NO_STATIONS: ReadonlyMap<number, Waystation> = new Map();

interface StationBadge {
  station: Waystation;
  badge: Badge;
}

/**
 * A save's wayline network as the game draws it: a dashed grey band along the lane between two
 * waystations, and a badge naming its level on every station's star. Once system names show,
 * the badge is its ring alone.
 */
export class WaylinesLayer implements MapLayer {
  readonly id = "waylines" as const;
  readonly container = new Container();
  private readonly bands = new Graphics({ label: "bands" });
  private readonly badgeLayer = new Container({ label: "badges" });
  private readonly badges: StationBadge[] = [];
  /** Network → how many stations stand in it, for what a badge's tooltip says. */
  private readonly counts = new Map<number, number>();
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private waylines: readonly Wayline[] = EMPTY_CONTEXT.waylines;
  private stations: ReadonlyMap<number, Waystation> = NO_STATIONS;
  private details: ReadonlyMap<number, SystemDetails> = EMPTY_CONTEXT.details;
  private nodeName = EMPTY_CONTEXT.nodeName;
  private dragged: ReadonlyMap<number, MoveGhost> = NO_DRAG;
  private readonly badgeScale = { x: 1, y: 1 };
  private ringScale = 1;
  private tier = labelTier(0);
  private hovered: Waystation | null = null;
  private readonly tip = new OwnedTooltip();

  constructor() {
    this.container.addChild(this.bands, this.badgeLayer);
  }

  rebuild(ctx: RenderContext): void {
    const same =
      ctx.galaxy === this.galaxy &&
      ctx.systems === this.systems &&
      ctx.waylines === this.waylines &&
      ctx.waystations === this.stations &&
      ctx.details === this.details;
    const restation = ctx.galaxy !== this.galaxy || ctx.waystations !== this.stations;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    this.waylines = ctx.waylines;
    this.stations = ctx.waystations;
    this.details = ctx.details;
    this.nodeName = ctx.nodeName;
    if (same) return;
    if (restation) this.build();
    this.place();
    this.draw();
  }

  applyDelta(): void {
    this.place();
    this.draw();
  }

  /** The bands and the badges of the systems being dragged follow their ghosts. */
  setDragState(drag: DragState | null): void {
    this.dragged = drag?.byId ?? NO_DRAG;
    this.place();
    this.draw();
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.badgeScale);
    this.ringScale = markerScale(cam.scale);
    for (const { badge } of this.badges) badge.setScale(this.badgeScale, this.ringScale);
    const tier = labelTier(cam.scale);
    if (tier !== this.tier) {
      this.tier = tier;
      this.place();
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private build(): void {
    this.badgeLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.badges.length = 0;
    this.counts.clear();
    this.hovered = null;
    for (const station of this.stations.values()) {
      this.counts.set(station.network, (this.counts.get(station.network) ?? 0) + 1);
      this.badges.push({ station, badge: this.makeBadge(station) });
    }
  }

  private makeBadge(station: Waystation): Badge {
    const badge = new Badge(badgeGeometry(this.tier));
    badge.onPlateHover(
      (at) => this.hover(station, at),
      () => this.unhover(station),
    );
    this.badgeLayer.addChild(badge.root);
    return badge;
  }

  /** Where a system is drawn: its ghost while it is dragged, else where it stands. */
  private point(id: number): { x: number; y: number } | undefined {
    return this.dragged.get(id) ?? this.systems.get(id);
  }

  /** The station's own level, a plain waystation until the system's details have been read. */
  private levelOf(station: Waystation): string {
    const starbase = this.details.get(station.system)?.starbase;
    const level = starbase?.id === station.starbase ? starbase.level : "";
    return starbaseLabel(isWaystationLevel(level) ? level : UNREAD_LEVEL);
  }

  private place(): void {
    const geo = badgeGeometry(this.tier);
    for (const { station, badge } of this.badges) {
      const at = this.point(station.system);
      badge.root.visible = at !== undefined;
      if (!at) continue;
      badge.root.position.set(at.x, at.y);
      badge.setScale(this.badgeScale, this.ringScale);
      badge.setLabel(geo, this.levelOf(station));
      badge.setIcon(null, geo.icon, BAND.color);
      const side = badgeSide(station.system, this.tier);
      badge.layout(geo, side, BAND.color, BADGE_RING_RADIUS * this.ringScale);
      badge.setPlated(this.tier === "none");
    }
  }

  private draw(): void {
    const g = this.bands;
    g.clear();
    for (const line of this.waylines) {
      const a = this.point(line.a);
      const b = this.point(line.b);
      if (!a || !b) continue;
      evenDashedLine(g, a, b, BAND.dash, BAND.gap);
      g.stroke({ color: BAND.color, alpha: BAND.alpha, width: BAND.width });
    }
  }

  private hover(station: Waystation, at: { x: number; y: number }): void {
    const s = this.systems.get(station.system);
    if (!s) return;
    this.hovered = station;
    const stations = this.counts.get(station.network) ?? 0;
    this.tip.show({
      x: at.x,
      y: at.y,
      title: this.levelOf(station),
      lines: [
        this.nodeName(s.name),
        `Network ${station.network} · ${counted(stations, "station")}`,
      ],
    });
  }

  private unhover(station: Waystation): void {
    if (this.hovered !== station) return;
    this.hovered = null;
    this.tip.hide();
  }
}
