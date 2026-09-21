import { BitmapText, Container, Graphics, Sprite, TextStyle, Ticker } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { SystemNode } from "../../generated/SystemNode";
import { SAVE_X_SIGN, SAVE_Y_SIGN, clamp } from "../../lib/geometry/geometry";
import { drawsBorders, isMarauder, territoryKind } from "../../lib/countryKinds";
import {
  affectedCountries,
  countryRegions,
  regionLabelAnchor,
  type LabelAnchor,
  type Region,
  type TerritoryParams,
} from "../../lib/geometry/territory";
import type { Camera } from "../Camera";
import { labelTier } from "../../lib/visual/labels";
import { ownerColors, type OwnerColors } from "../../lib/visual/ownerColors";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { EMPHASIS_COLOR, symbolKey } from "../../lib/visual/specialStyle";
import { MAP_FONT } from "../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import type { MapLayer } from "./MapLayer";
import { TerritoryShapes } from "./TerritoryShapes";

const EMPHASIS_PX = 3;
const EMPHASIS_GLOW_PX = 18;
const EMPHASIS_GLOW_ALPHA = 0.3;
const LABEL_FONT_PX = 32;
/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const LABEL_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: LABEL_FONT_PX,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 4, alpha: 0.6 },
});
const LABEL_ALPHA = 0.9;
/**
 * Name height and emblem diameter grow with the region's extent (√area, world units) faster
 * than in proportion, as the game's do: a one-system empire reads small, a wide one large.
 */
const LABEL_SIZE_RATIO = 0.27;
const LABEL_SIZE_OFFSET = 5;
const LABEL_MIN_SIZE = 8;
const LABEL_MAX_SIZE = 70;
const LABEL_GAP_RATIO = 0.15;
/** The rendered name's width is capped to this fraction of the region's bounding-box width. */
const LABEL_WIDTH_RATIO = 0.9;
const EMBLEM_ALPHA = 0.55;
const EMBLEM_SIZE_RATIO = 0.6;
const EMBLEM_SIZE_OFFSET = 17;
const EMBLEM_MIN_SIZE = 12;
const EMBLEM_MAX_SIZE = 180;
/** The emblem's diameter is capped to this fraction of the region's narrower bounding-box side. */
const EMBLEM_WIDTH_RATIO = 0.35;
const FADE_MS = 450;

/** What the layer draws for a country over the territory the painter holds for it. */
interface CountryShape {
  anchor: LabelAnchor | null;
  emphasis: Graphics;
  badge: Container;
  emblem: Sprite;
  label: BitmapText;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The systems again, with the owner of every one whose claim the map is hiding taken off it. */
function unclaimed(systems: Systems, hidden: ReadonlySet<number>): Systems {
  if (hidden.size === 0) return systems;
  const out = new Map(systems);
  for (const id of hidden) {
    const s = out.get(id);
    if (s && s.owner !== null) out.set(id, { ...s, owner: null });
  }
  return out;
}

/**
 * The game's territories: each country's region from `countryRegions`, its corners rounded,
 * filled with its second flag colour and outlined with its first in a chunky screen-stable
 * stroke over a soft halo. At the region's pole of inaccessibility the empire's flag symbol and
 * name sit in world units, sized to the region; they fade in while system names are hidden and
 * out as they appear. A delta recomputes only the countries it can have changed.
 */
export class OwnersLayer implements MapLayer {
  readonly id = "owners" as const;
  readonly container = new Container();
  /** The painted regions, hidden with the layer; the emphasis between them and the badges stays. */
  private readonly territories = new Container({ label: "territories" });
  private readonly painter = new TerritoryShapes();
  private readonly emphases = new Container({ label: "emphases" });
  private readonly badges = new Container({ label: "badges" });
  private emphasised = new Set<number>();
  private shownKinds: ReadonlySet<SpecialKind> = new Set();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private previous: Map<number, SystemNode> = new Map();
  private countryIndex = new Map<number, number>();
  private readonly shapes = new Map<number, CountryShape>();
  private readonly emblemKeys = new Map<number, string>();
  private fade = 1;
  private fadeTarget = 1;
  private fading = false;
  private shown = true;
  private readonly unsubscribeTextures: () => void;

  constructor() {
    this.territories.addChild(this.painter.fills, this.painter.edges);
    this.container.addChild(this.territories, this.emphases, this.badges);
    this.unsubscribeTextures = onTextures((keys) => this.onTexturesLanded(keys));
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = unclaimed(ctx.systems, ctx.hiddenOwners);
    if (
      ctx.galaxy !== prev.galaxy ||
      ctx.countries !== prev.countries ||
      ctx.hiddenOwners !== prev.hiddenOwners
    ) {
      this.previous = new Map(this.systems);
      this.countryIndex = new Map();
      let index = 0;
      for (const id of ctx.countries.keys()) this.countryIndex.set(id, index++);
      this.redrawAll();
      this.refreshEmphasis();
      return;
    }
    if (ctx.border !== prev.border) {
      this.redrawAll();
      return;
    }
    if (ctx.countryTypes !== prev.countryTypes) {
      this.redrawAll();
      this.refreshEmphasis();
      return;
    }
    if (ctx.mapColors !== prev.mapColors) this.painter.recolor((id) => this.colorsOf(id));
    if (ctx.mapColors !== prev.mapColors || ctx.special !== prev.special) {
      for (const [id, shape] of this.shapes) this.placeEmblem(id, shape);
    }
    if (ctx.names !== prev.names) {
      for (const [id, shape] of this.shapes) {
        if (this.retext(id, shape)) this.placeEmblem(id, shape);
      }
    }
    if (ctx.hiddenCountries !== prev.hiddenCountries) this.refreshHidden();
  }

  applyDelta(d: GalaxyDelta): void {
    const removed = d.removed ?? [];
    const gone = removed.flatMap((id) => this.previous.get(id) ?? []);
    const changed = d.systems.map((s) => this.systems.get(s.id) ?? s);
    const affected = affectedCountries(
      [...changed, ...gone],
      this.previous,
      this.systems,
      this.params(),
    );
    for (const id of removed) this.previous.delete(id);
    for (const s of changed) this.previous.set(s.id, s);
    const bordered = this.bordered();
    for (const id of affected) if (!bordered.has(id)) affected.delete(id);
    if (affected.size === 0) return;
    const regions = countryRegions(this.systems.values(), this.params(), affected);
    for (const id of affected) {
      const region = regions.get(id);
      if (region) this.show(id, region);
      else this.remove(id);
    }
  }

  onViewport(cam: Camera): void {
    if (this.painter.setUnit(cam.scale)) {
      for (const [id, shape] of this.shapes) this.drawEmphasis(id, shape);
    }
    if (this.shown) this.fadeTowards(labelTier(cam.scale) === "none" ? 1 : 0);
  }

  /** The territories go with the layer; the emphasis of the kinds shown as points of interest stays. */
  setVisible(v: boolean): void {
    this.shown = v;
    this.applyVisibility();
  }

  setShownKinds(kinds: ReadonlySet<SpecialKind>): void {
    this.shownKinds = kinds;
    this.refreshEmphasis();
  }

  destroy(): void {
    this.unsubscribeTextures();
    Ticker.shared.remove(this.fadeTick, this);
    this.painter.destroy();
    this.container.destroy({ children: true });
  }

  private applyVisibility(): void {
    this.territories.visible = this.shown;
    this.badges.visible = this.shown && this.fade > 0;
    this.container.visible = this.shown || this.emphasised.size > 0;
  }

  private params(): TerritoryParams {
    return {
      radius: this.ctx.border.system_radius,
      laneHalfWidth: this.ctx.border.hyperlane_thickness / 2,
    };
  }

  /**
   * The countries the game paints a territory for; the others' systems only clip. A scenario's
   * marauder clans are painted by the marauders layer from their initializers, not here.
   */
  private bordered(): Set<number> {
    const ids = new Set<number>();
    const scenario = this.ctx.kind === "scenario";
    for (const c of this.ctx.countries.values()) {
      if (scenario && isMarauder(c)) continue;
      if (drawsBorders(c, this.ctx.countryTypes)) ids.add(c.id);
    }
    return ids;
  }

  private redrawAll(): void {
    const regions = countryRegions(this.systems.values(), this.params(), this.bordered());
    for (const id of [...this.shapes.keys()]) if (!regions.has(id)) this.remove(id);
    for (const [id, region] of regions) this.show(id, region);
  }

  private show(id: number, region: Region): void {
    let shape = this.shapes.get(id);
    if (!shape) {
      const label = new BitmapText({ text: "", style: LABEL_STYLE });
      label.anchor.set(0.5, 0);
      label.alpha = LABEL_ALPHA;
      const emblem = new Sprite();
      emblem.anchor.set(0.5, 0.5);
      emblem.alpha = EMBLEM_ALPHA;
      emblem.visible = false;
      const badge = new Container();
      badge.addChild(emblem, label);
      badge.visible = false;
      shape = { anchor: null, emphasis: new Graphics(), badge, emblem, label };
      this.emphases.addChild(shape.emphasis);
      this.badges.addChild(badge);
      this.shapes.set(id, shape);
      this.retext(id, shape);
    }
    this.painter.show(id, region, this.colorsOf(id));
    shape.anchor = regionLabelAnchor(region);
    this.placeEmblem(id, shape);
    this.drawEmphasis(id, shape);
    this.applyHidden(id, shape);
  }

  /** The eye in the Empires list: a hidden country keeps its shape but paints nothing. */
  private refreshHidden(): void {
    for (const [id, shape] of this.shapes) this.applyHidden(id, shape);
  }

  private applyHidden(id: number, shape: CountryShape): void {
    const shown = !this.ctx.hiddenCountries.has(id);
    this.painter.setHidden(id, !shown);
    shape.emphasis.visible = shown;
    shape.badge.visible = shown && shape.anchor !== null;
  }

  private remove(id: number): void {
    const shape = this.shapes.get(id);
    if (!shape) return;
    this.painter.remove(id);
    shape.emphasis.destroy();
    shape.badge.destroy({ children: true });
    this.shapes.delete(id);
    this.emblemKeys.delete(id);
  }

  private colorsOf(id: number): OwnerColors {
    return ownerColors(
      this.ctx.countries.get(id),
      this.countryIndex.get(id) ?? 0,
      this.ctx.mapColors,
    );
  }

  /** Clans and fallen empires are marked by their borders while the special layer shows their kind. */
  private refreshEmphasis(): void {
    const emphasised = new Set<number>();
    for (const c of this.ctx.countries.values()) {
      const kind = territoryKind(c, this.ctx.countryTypes);
      if (kind !== null && this.shownKinds.has(kind)) emphasised.add(c.id);
    }
    this.emphasised = emphasised;
    for (const [id, shape] of this.shapes) this.drawEmphasis(id, shape);
    this.applyVisibility();
  }

  private drawEmphasis(id: number, { emphasis }: CountryShape): void {
    emphasis.clear();
    if (!this.emphasised.has(id)) return;
    const smoothed = this.painter.shape(id)?.smoothed ?? [];
    const unit = this.painter.unit;
    for (const polygon of smoothed) emphasis.poly(polygon[0], true);
    emphasis.stroke({
      color: EMPHASIS_COLOR,
      width: EMPHASIS_GLOW_PX * unit,
      alpha: EMPHASIS_GLOW_ALPHA,
      join: "round",
    });
    for (const polygon of smoothed) emphasis.poly(polygon[0], true);
    emphasis.stroke({ color: EMPHASIS_COLOR, width: EMPHASIS_PX * unit, join: "round" });
  }

  private placeEmblem(id: number, shape: CountryShape): void {
    const { badge, emblem, label, anchor } = shape;
    badge.visible = anchor !== null && !this.ctx.hiddenCountries.has(id);
    if (anchor === null) return;
    const key = symbolKey(this.ctx.countries.get(id)?.flag_icon);
    if (key === null) this.emblemKeys.delete(id);
    else this.emblemKeys.set(id, key);
    const texture = key === null ? null : getTexture(key);
    if (key !== null && texture === undefined) requestTextures([key]);
    badge.position.set(anchor.x, anchor.y);
    let size = clamp(
      anchor.extent * LABEL_SIZE_RATIO - LABEL_SIZE_OFFSET,
      LABEL_MIN_SIZE,
      LABEL_MAX_SIZE,
    );
    label.scale.set(1, 1);
    const textWidth = label.width;
    if (textWidth > 0) {
      const maxByWidth = (LABEL_WIDTH_RATIO * anchor.width * LABEL_FONT_PX) / textWidth;
      size = Math.max(LABEL_MIN_SIZE, Math.min(size, maxByWidth));
    }
    const ratio = size / LABEL_FONT_PX;
    label.scale.set(SAVE_X_SIGN * ratio, SAVE_Y_SIGN * ratio);
    emblem.visible = Boolean(texture);
    if (!texture) {
      label.position.set(0, SAVE_Y_SIGN * (-size / 2));
      return;
    }
    const diameter = Math.max(
      EMBLEM_MIN_SIZE,
      Math.min(
        clamp(
          anchor.extent * EMBLEM_SIZE_RATIO - EMBLEM_SIZE_OFFSET,
          EMBLEM_MIN_SIZE,
          EMBLEM_MAX_SIZE,
        ),
        EMBLEM_WIDTH_RATIO * Math.min(anchor.width, anchor.height),
      ),
    );
    emblem.texture = texture;
    emblem.scale.set(
      (SAVE_X_SIGN * diameter) / (texture.width || 1),
      (SAVE_Y_SIGN * diameter) / (texture.height || 1),
    );
    // The emblem and name together sit centred on the anchor.
    const gap = size * LABEL_GAP_RATIO;
    const total = diameter + gap + size;
    emblem.position.set(0, SAVE_Y_SIGN * (diameter / 2 - total / 2));
    label.position.set(0, SAVE_Y_SIGN * (diameter + gap - total / 2));
  }

  private onTexturesLanded(keys: string[]): void {
    const settled = new Set(keys);
    for (const [id, key] of this.emblemKeys) {
      if (!settled.has(key)) continue;
      const shape = this.shapes.get(id);
      if (shape) this.placeEmblem(id, shape);
    }
  }

  private retext(id: number, shape: CountryShape): boolean {
    const text = this.ctx.countryName(id);
    if (shape.label.text === text) return false;
    shape.label.text = text;
    return true;
  }

  private fadeTowards(target: number): void {
    if (target === this.fadeTarget) return;
    this.fadeTarget = target;
    if (!this.fading) {
      this.fading = true;
      Ticker.shared.add(this.fadeTick, this);
    }
  }

  private fadeTick(ticker: Ticker): void {
    const step = ticker.deltaMS / FADE_MS;
    this.fade = clamp(this.fade + Math.sign(this.fadeTarget - this.fade) * step, 0, 1);
    this.badges.alpha = smoothstep(this.fade);
    this.applyVisibility();
    if (this.fade === this.fadeTarget) {
      this.fading = false;
      Ticker.shared.remove(this.fadeTick, this);
    }
  }
}
