import { Container, type Texture } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { SpecialSystem } from "../../generated/SpecialSystem";
import type { SystemNode } from "../../generated/SystemNode";
import { kindLabel } from "../../lib/special";
import { OwnedTooltip } from "../ownedTooltip";
import type { Camera } from "../Camera";
import { labelTier, type LabelTier } from "../../lib/visual/labels";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import {
  type BadgeGeometry,
  badgeGeometry,
  badgeIconKey,
  badgeLabel,
  badgeSide,
  badgeVisible,
  KIND_STYLE,
} from "../../lib/visual/specialStyle";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { onTextures } from "../../lib/visual/textures";
import { Badge, badgeTexture, BADGE_RING_RADIUS } from "./badge";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

/** What the badge's tooltip says beyond the kind: the classifier's label, its countries, its initializer. */
function tooltipLines(special: SpecialSystem, displayName: (key: string) => string): string[] {
  const lines = [
    special.label,
    ...special.countries.map((c) => c.name ?? displayName(c.name_key)),
    special.initializer,
  ];
  return [...new Set(lines.filter((line) => line !== ""))];
}

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/**
 * The editor's own overlay, switched on to find the systems that matter: each special system
 * whose primary kind is shown gets a ring on its star and a dark plate beside it carrying
 * the kind's icon (the game's art where it has some) and a label that always says what the
 * system is. Zoomed out, the plate grows and a halo makes the star obvious; zoomed in it
 * shrinks to sit clear of the name and details bar below the star. Notable kinds keep their
 * badge at every zoom; common kinds only once names show.
 */
export class SpecialLayer implements MapLayer {
  readonly id = "special" as const;
  readonly container = new Container();
  private readonly badges = new Map<number, Badge>();
  private readonly iconKeys = new Map<number, string>();
  /** Badged landmarks, whose labels come from the details their systems hold. */
  private readonly landmarks = new Set<number>();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private shown: ReadonlySet<SpecialKind> = new Set();
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private hovered: number | null = null;
  private readonly tip = new OwnedTooltip();
  private readonly pxScale = { x: 1, y: 1 };
  private ringScale = 1;
  private tier: LabelTier = "none";
  private readonly unsubscribeTextures: () => void;

  constructor() {
    this.container.eventMode = "passive";
    this.unsubscribeTextures = onTextures((keys) => this.onTexturesLanded(keys));
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.galaxy !== prev.galaxy) {
      this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.badges.clear();
      this.iconKeys.clear();
      this.landmarks.clear();
      this.hovered = null;
      for (const s of ctx.systems.values()) this.place(s);
      return;
    }
    if (ctx.special !== prev.special || ctx.names !== prev.names) {
      this.replaceAll();
      return;
    }
    if (ctx.detailsVersion !== prev.detailsVersion) this.replaceLandmarks();
  }

  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) this.remove(id);
    for (const s of d.systems) this.place(s);
  }

  setShownKinds(shown: ReadonlySet<SpecialKind>): void {
    this.shown = shown;
    this.replaceAll();
  }

  /** The dragged systems' badges follow their ghosts, dimmed. */
  setDragState(drag: DragState | null): void {
    const byId = drag?.byId ?? NO_GHOSTS;
    const affected = new Set([...this.ghosts.keys(), ...byId.keys()]);
    this.ghosts = byId;
    for (const id of affected) {
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.pxScale);
    this.ringScale = markerScale(cam.scale);
    for (const badge of this.badges.values()) badge.setScale(this.pxScale, this.ringScale);
    const tier = labelTier(cam.scale);
    if (tier !== this.tier) {
      this.tier = tier;
      this.replaceAll();
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.unsubscribeTextures();
    this.container.destroy({ children: true });
  }

  private replaceAll(): void {
    for (const s of this.systems.values()) this.place(s);
  }

  private replaceLandmarks(): void {
    for (const id of this.landmarks) {
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  private onTexturesLanded(keys: string[]): void {
    const settled = new Set(keys);
    for (const [id, key] of this.iconKeys) {
      if (!settled.has(key)) continue;
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  private classify(s: SystemNode): SpecialSystem | undefined {
    return this.ctx.special.get(s.id);
  }

  private place(s: SystemNode): void {
    const special = this.classify(s);
    const shown =
      special !== undefined &&
      this.shown.has(special.primary) &&
      badgeVisible(special.primary, this.tier);
    if (!shown) {
      this.remove(s.id);
      return;
    }
    const kind = special.primary;
    const { color } = KIND_STYLE[kind];
    const geo = badgeGeometry(this.tier);
    let badge = this.badges.get(s.id);
    if (!badge) {
      badge = this.makeBadge(s.id, geo);
      this.badges.set(s.id, badge);
    }
    const ghost = this.ghosts.get(s.id);
    const at = ghost ?? s;
    badge.root.position.set(at.x, at.y);
    badge.root.alpha = ghost ? GHOST_ALPHA : 1;
    badge.setScale(this.pxScale, this.ringScale);
    badge.setLabel(geo, this.labelFor(s, kind, special));

    badge.setIcon(this.iconFor(s, kind, special), geo.icon, color);
    badge.layout(geo, badgeSide(s.id, this.tier), color, BADGE_RING_RADIUS * this.ringScale);
  }

  private labelFor(s: SystemNode, kind: SpecialKind, special: SpecialSystem): string {
    const { names, specialWithGameData } = this.ctx;
    const labelled = specialWithGameData ? special : { ...special, label: "" };
    return badgeLabel(
      kind,
      labelled,
      this.ctx.nodeName(s.name),
      names,
      kind === "landmark" ? this.megastructuresOf(s.id) : [],
    );
  }

  private megastructuresOf(id: number): readonly MegastructureSummary[] {
    this.landmarks.add(id);
    this.ctx.requestDetails([id]);
    return this.ctx.details.get(id)?.megastructures ?? [];
  }

  private iconFor(s: SystemNode, kind: SpecialKind, special: SpecialSystem): Texture | null {
    const key = badgeIconKey(kind, special);
    this.iconKeys.set(s.id, key);
    return badgeTexture(key);
  }

  private makeBadge(id: number, geo: BadgeGeometry): Badge {
    const badge = new Badge(geo);
    badge.onPlateHover(
      (at) => this.hover(id, at),
      () => this.unhover(id),
    );
    this.container.addChild(badge.root);
    return badge;
  }

  private hover(id: number, at: { x: number; y: number }): void {
    const s = this.systems.get(id);
    const special = s && this.classify(s);
    if (!special) return;
    this.hovered = id;
    this.tip.show({
      x: at.x,
      y: at.y,
      title: kindLabel(special.primary),
      lines: tooltipLines(special, this.ctx.displayName),
    });
  }

  private unhover(id: number): void {
    if (this.hovered !== id) return;
    this.hovered = null;
    this.tip.hide();
  }

  private remove(id: number): void {
    this.iconKeys.delete(id);
    this.landmarks.delete(id);
    const badge = this.badges.get(id);
    if (!badge) return;
    this.unhover(id);
    badge.destroy();
    this.badges.delete(id);
  }
}
