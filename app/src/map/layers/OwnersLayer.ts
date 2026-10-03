import { BitmapText, Container, Graphics, Sprite, TextStyle, Ticker } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { SystemNode } from "../../generated/SystemNode";
import { SAVE_X_SIGN, SAVE_Y_SIGN, clamp } from "../../lib/geometry/geometry";
import {
  placeLabels,
  type LabelFit,
  type LabelRequest,
  type LabelShape,
  type PieceScan,
} from "../../lib/geometry/labelFit";
import type { Region, TerritoryParams, TerritorySystem } from "../../lib/geometry/territory";
import type { Reply, Shape } from "../../lib/geometry/territories";
import { InlineTerritoryClient, type TerritoryClient } from "../../lib/geometry/territoryClient";
import { ownerTerritoryKind } from "../../lib/ownership";
import type { Camera } from "../Camera";
import { EMPIRE_LABEL_MAX_SCALE } from "../../lib/visual/labels";
import { mixColor } from "../../lib/visual/color";
import type { OwnerColors } from "../../lib/visual/ownerColors";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { EMPHASIS_COLOR, symbolKey } from "../../lib/visual/specialStyle";
import { hasGameMapFont, mapNameFamily, onMapNameFont } from "../../lib/visual/mapFont";
import { MAP_FONT } from "../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import type { MapLayer } from "./MapLayer";

/** The game's fill reads about 0.2 deep inside a territory and about 0.45 at its rim. */
const FILL_ALPHA = 0.3;
/**
 * The border band lies inside its own territory, so neighbours' bands sit side by side. The
 * game's measures about 16 px at every zoom until the camera stops widening it in world units.
 */
const BAND_PX = 16;
const BAND_MAX_WORLD = 8;
/** The fill colour's bright line just inside the band. */
const RIM_PX = 2;
const RIM_ALPHA = 0.8;
/** The outer quarter of the band is darkened, the seam between two neighbours. */
const SEAM_SHARE = 0.25;
const SEAM_DARKEN = 0.25;
const EMPHASIS_PX = 3;
const EMPHASIS_GLOW_PX = 18;
const EMPHASIS_GLOW_ALPHA = 0.3;
/** Strokes hold their screen width until a pixel spans this many world units, then stop growing. */
const STROKE_MAX_UNIT = 2;
/** The stroke width is snapped to steps of √2 so zooming redraws it rarely. */
const STROKE_STEPS_PER_OCTAVE = 2;
const LABEL_FONT_PX = 32;
/** The game draws names pale and a little see-through, with a soft dark glow and no shadow. */
const NAME_COLOR = 0xeef1f6;
const NAME_ALPHA = 0.85;
const NAME_GLOW = {
  color: 0x000000,
  alpha: 0.45,
  blur: 6,
  distance: 0,
  angle: 0,
};
/** A name's tracking in the fallback face, which is narrower than the game's. */
const FALLBACK_SPACING = 3;
const GAME_SPACING = 1;

/** A new style for every face change: PixiJS keys a dynamic bitmap font by the style object. */
function nameStyle(): TextStyle {
  const game = hasGameMapFont();
  return new TextStyle({
    fontFamily: mapNameFamily(),
    fontSize: LABEL_FONT_PX,
    fontWeight: game ? "normal" : "300",
    letterSpacing: game ? GAME_SPACING : FALLBACK_SPACING,
    fill: NAME_COLOR,
    dropShadow: NAME_GLOW,
  });
}

/** The glyph that stands where a marauder clan's flag would: the game's clans fly none. */
export const CLAN_GLYPH = "☠";
const GLYPH_FONT_PX = 32;
const GLYPH_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: GLYPH_FONT_PX,
  fill: 0xffffff,
});
/**
 * Name sizes are font sizes in world units, so names zoom with the map. A name never grows past
 * the cap however large its piece is.
 */
const LABEL_MAX_SIZE = 44;
/**
 * The narrowest a name is written is this share of `MAPNAME_BORDER_MIN_SIZE`, overflowing a
 * piece too small for it: in game screenshots the names on one-system pockets are half as wide
 * as that define read in world units.
 */
const NAME_MIN_WIDTH_SHARE = 0.5;
/** For a short name the floor stops at this font size. */
const LABEL_FLOOR_MAX_SIZE = 6;
/** The emblem is a square this many font sizes tall, sitting on the name's cap height. */
const EMBLEM_SIZE = 3.2;
/**
 * How far, in font sizes, the emblem's square reaches down into the name's line, whose top
 * stands clear of the letters: in the game the emblem nearly touches the top of the name.
 */
const EMBLEM_DROP = 0.3;
/** Flat white and see-through, as the game shows a territory's flag symbol. */
const EMBLEM_ALPHA = 0.7;
const FADE_MS = 450;

/** One territory piece's emblem and name. */
interface PieceBadge {
  badge: Container;
  emblem: Sprite;
  /** A clan's emblem, in the outline colour like its name; hidden for a country. */
  glyph: BitmapText;
  label: BitmapText;
}

interface CountryShape {
  /** The drawn outline: the country's region with its corners rounded off. */
  smoothed: Region;
  /** Each piece of the outline, scanned for room for its label. */
  scans: PieceScan[];
  colors: OwnerColors;
  fill: Graphics;
  edge: Graphics;
  emphasis: Graphics;
  /** One badge per piece: the game labels every separate piece of a country. */
  badges: Container;
  pieces: PieceBadge[];
  /** Whether the badges show an emblem or a clan's glyph above the name. */
  art: boolean;
}

/** World units per screen pixel for the strokes, capped and snapped. */
function strokeUnit(camScale: number): number {
  const wanted = Math.min(STROKE_MAX_UNIT, 1 / camScale);
  const step = Math.round(Math.log2(wanted) * STROKE_STEPS_PER_OCTAVE);
  return Math.pow(2, step / STROKE_STEPS_PER_OCTAVE);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Strokes every ring of `region` on the territory's side: inside each outer ring, outside
 * each hole, so a band never spills into a neighbour.
 */
function strokeInside(
  g: Graphics,
  region: Region,
  style: { color: number; width: number; alpha?: number },
): void {
  for (const [outer] of region) g.poly(outer, true);
  g.stroke({ ...style, alignment: 1, join: "round" });
  const holes = region.flatMap((polygon) => polygon.slice(1));
  if (holes.length === 0) return;
  for (const hole of holes) g.poly(hole, true);
  g.stroke({ ...style, alignment: 0, join: "round" });
}

/** Whether two owner tables paint the same set of owners, whatever else about them changed. */
function sameOwners(a: ReadonlyMap<number, unknown>, b: ReadonlyMap<number, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a.keys()) if (!b.has(id)) return false;
  return true;
}

/**
 * The game's territories: each owner's region from the composed ownership, its corners rounded,
 * filled with its second flag colour and outlined with its first in a chunky screen-stable
 * stroke over a soft halo. Each separate piece of a region shows the empire's flag symbol over
 * its name, in world units, in the widest room the piece has; they fade in while system names
 * are hidden and out as they appear. A marauder clan's badge shows a skull in place of a flag. The regions
 * come from the client, a beat later when it is a worker; a delta recomputes only the owners it
 * can have changed.
 */
export class OwnersLayer implements MapLayer {
  readonly id = "owners" as const;
  readonly container = new Container();
  /** The painted regions, hidden with the layer; the emphasis between them and the badges stays. */
  private readonly territories = new Container({ label: "territories" });
  private readonly fills = new Container({ label: "fills" });
  private readonly edges = new Container({ label: "edges" });
  private readonly emphases = new Container({ label: "emphases" });
  private readonly badges = new Container({ label: "badges" });
  private emphasised = new Set<number>();
  private shownKinds: ReadonlySet<SpecialKind> = new Set();
  private ctx: RenderContext = EMPTY_CONTEXT;
  /** The owner of every system as last sent to the client, hidden ones taken off. */
  private owners: ReadonlyMap<number, number> = EMPTY_CONTEXT.owners;
  private readonly shapes = new Map<number, CountryShape>();
  private readonly emblemKeys = new Map<number, string>();
  private unit = 1;
  private fade = 1;
  private fadeTarget = 1;
  private fading = false;
  private shown = true;
  private clansShown = true;
  /** Bumped with every reset so a reply to an earlier galaxy is told apart and dropped. */
  private epoch = 0;
  private destroyed = false;
  private readonly unsubscribeTextures: () => void;
  private readonly unsubscribeFont: () => void;
  private labelStyle = nameStyle();

  constructor(private readonly client: TerritoryClient = new InlineTerritoryClient()) {
    this.territories.addChild(this.fills, this.edges);
    this.container.addChild(this.territories, this.emphases, this.badges);
    this.unsubscribeTextures = onTextures((keys) => this.onTexturesLanded(keys));
    this.unsubscribeFont = onMapNameFont(() => this.onFontChanged());
    client.onReply((reply) => this.onReply(reply));
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    if (
      ctx.galaxy !== prev.galaxy ||
      ctx.kind !== prev.kind ||
      ctx.hiddenOwners !== prev.hiddenOwners ||
      ctx.border !== prev.border ||
      (ctx.table !== prev.table && !sameOwners(ctx.table, prev.table))
    ) {
      this.recompute();
      this.refreshEmphasis();
      return;
    }
    if (ctx.table !== prev.table) {
      for (const [id, shape] of this.shapes) this.paint(id, shape);
      for (const [id, shape] of this.shapes) this.retext(id, shape);
      this.refreshEmphasis();
    }
    if (ctx.table !== prev.table || ctx.special !== prev.special) {
      for (const [id, shape] of this.shapes) this.placeEmblem(id, shape);
      this.layoutLabels();
    }
    if (ctx.table === prev.table && ctx.countryTypes !== prev.countryTypes) this.refreshEmphasis();
    if (ctx.hiddenCountries !== prev.hiddenCountries) {
      this.refreshHidden();
      this.layoutLabels();
    }
  }

  /** The delta's systems, and any whose composed owner it changed without touching them. */
  applyDelta(d: GalaxyDelta): void {
    const ids = new Set(d.systems.map((s) => s.id));
    const owners = this.hiddenTakenOff(this.ctx.owners);
    if (owners !== this.owners) {
      for (const [id, owner] of owners) if (this.owners.get(id) !== owner) ids.add(id);
      for (const id of this.owners.keys()) if (!owners.has(id)) ids.add(id);
    }
    this.owners = owners;
    const changed: TerritorySystem[] = [];
    for (const id of ids) {
      const s = this.ctx.systems.get(id);
      if (s) changed.push(this.territorySystem(s));
    }
    this.client.apply(changed, d.removed ?? [], this.epoch);
  }

  onViewport(cam: Camera): void {
    const unit = strokeUnit(cam.scale);
    if (unit !== this.unit) {
      this.unit = unit;
      for (const [id, shape] of this.shapes) {
        this.drawFill(shape);
        this.drawEdge(shape);
        this.drawEmphasis(id, shape);
      }
    }
    if (this.shown) this.fadeTowards(cam.scale < EMPIRE_LABEL_MAX_SCALE ? 1 : 0);
  }

  /** The countries' territories go with the layer; the emphasis of the kinds shown as points of interest stays. */
  setVisible(v: boolean): void {
    this.shown = v;
    this.applyVisibility();
  }

  /** The clans' territories go with the marauder clans layer, whatever this one is set to. */
  setClansShown(v: boolean): void {
    this.clansShown = v;
    this.applyVisibility();
  }

  setShownKinds(kinds: ReadonlySet<SpecialKind>): void {
    this.shownKinds = kinds;
    this.refreshEmphasis();
  }

  destroy(): void {
    this.destroyed = true;
    this.client.destroy();
    this.unsubscribeTextures();
    this.unsubscribeFont();
    Ticker.shared.remove(this.fadeTick, this);
    this.container.destroy({ children: true });
  }

  private applyVisibility(): void {
    this.territories.visible = this.shown || this.clansShown;
    this.badges.visible = this.shown && this.fade > 0;
    this.container.visible = this.shown || this.clansShown || this.emphasised.size > 0;
    this.refreshHidden();
  }

  private params(): TerritoryParams {
    return {
      radius: this.ctx.border.system_radius,
      laneHalfWidth: this.ctx.border.hyperlane_thickness / 2,
    };
  }

  /** The composed owners with every system the map is hiding the owner of taken off. */
  private hiddenTakenOff(owners: ReadonlyMap<number, number>): ReadonlyMap<number, number> {
    const hidden = this.ctx.hiddenOwners;
    if (hidden.size === 0) return owners;
    const out = new Map(owners);
    for (const id of hidden) out.delete(id);
    return out;
  }

  private territorySystem(s: SystemNode): TerritorySystem {
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      owner: this.owners.get(s.id) ?? null,
      lanes: s.lanes,
    };
  }

  /** Every owner in the table gets a territory; the other owners' systems only clip. */
  private recompute(): void {
    this.epoch++;
    this.owners = this.hiddenTakenOff(this.ctx.owners);
    const systems = [...this.ctx.systems.values()].map((s) => this.territorySystem(s));
    this.client.reset(systems, this.params(), this.ctx.table.keys(), this.epoch);
  }

  /** A reset answers for the whole galaxy, an apply for the countries it touched. */
  private onReply(reply: Reply): void {
    if (this.destroyed || reply.epoch < this.epoch) return;
    if (reply.kind === "reset") {
      const kept = new Set(reply.shapes.map(([id]) => id));
      for (const id of [...this.shapes.keys()]) if (!kept.has(id)) this.remove(id);
    } else {
      for (const id of reply.removed) this.remove(id);
    }
    for (const [id, shape] of reply.shapes) this.show(id, shape);
    this.layoutLabels();
  }

  private show(id: number, { smoothed, scans }: Shape): void {
    let shape = this.shapes.get(id);
    if (!shape) {
      const badges = new Container();
      badges.visible = false;
      shape = {
        smoothed: [],
        scans: [],
        colors: { outline: 0, fill: 0 },
        fill: new Graphics(),
        edge: new Graphics(),
        emphasis: new Graphics(),
        badges,
        pieces: [],
        art: false,
      };
      this.fills.addChild(shape.fill);
      this.edges.addChild(shape.edge);
      this.emphases.addChild(shape.emphasis);
      this.badges.addChild(badges);
      this.shapes.set(id, shape);
    }
    shape.smoothed = smoothed;
    shape.scans = scans;
    this.matchPieces(shape);
    this.retext(id, shape);
    this.placeEmblem(id, shape);
    this.paint(id, shape);
    this.drawEmphasis(id, shape);
    this.applyHidden(id, shape);
  }

  /** As many piece badges as the country has pieces. */
  private matchPieces(shape: CountryShape): void {
    while (shape.pieces.length > shape.scans.length) {
      shape.pieces.pop()?.badge.destroy({ children: true });
    }
    while (shape.pieces.length < shape.scans.length) {
      const text = shape.pieces[0]?.label.text ?? "";
      const label = new BitmapText({ text, style: this.labelStyle });
      label.anchor.set(0.5, 0);
      label.alpha = NAME_ALPHA;
      const emblem = new Sprite();
      emblem.anchor.set(0.5, 0.5);
      emblem.alpha = EMBLEM_ALPHA;
      emblem.visible = false;
      const glyph = new BitmapText({ text: CLAN_GLYPH, style: GLYPH_STYLE });
      glyph.anchor.set(0.5, 0.5);
      glyph.alpha = EMBLEM_ALPHA;
      glyph.visible = false;
      const badge = new Container();
      badge.addChild(emblem, glyph, label);
      shape.badges.addChild(badge);
      shape.pieces.push({ badge, emblem, glyph, label });
    }
  }

  /** The eye in the Empires list: a hidden country keeps its shape but paints nothing. */
  private refreshHidden(): void {
    for (const [id, shape] of this.shapes) this.applyHidden(id, shape);
  }

  private applyHidden(id: number, shape: CountryShape): void {
    const listed = !this.ctx.hiddenCountries.has(id);
    const painted = listed && (this.isClan(id) ? this.clansShown : this.shown);
    shape.fill.visible = painted;
    shape.edge.visible = painted;
    shape.emphasis.visible = listed;
    shape.badges.visible = listed && this.badged(id);
  }

  private isClan(id: number): boolean {
    return this.ctx.table.get(id)?.kind === "marauder_clan";
  }

  /** Every owner in the table shows its emblem and name on each piece of its region. */
  private badged(id: number): boolean {
    return this.ctx.table.has(id);
  }

  private remove(id: number): void {
    const shape = this.shapes.get(id);
    if (!shape) return;
    shape.fill.destroy();
    shape.edge.destroy();
    shape.emphasis.destroy();
    shape.badges.destroy({ children: true });
    this.shapes.delete(id);
    this.emblemKeys.delete(id);
  }

  private paint(id: number, shape: CountryShape): void {
    const colors = this.ctx.table.get(id)?.colors;
    if (!colors) return;
    shape.colors = colors;
    this.drawFill(shape);
    this.drawEdge(shape);
  }

  private drawFill({ fill, smoothed, colors }: CountryShape): void {
    fill.clear();
    for (const [outer, ...holes] of smoothed) {
      fill.poly(outer, true).fill({ color: colors.fill, alpha: FILL_ALPHA });
      if (holes.length === 0) continue;
      for (const hole of holes) fill.poly(hole, true);
      fill.cut();
    }
    strokeInside(fill, smoothed, {
      color: colors.fill,
      width: this.bandWidth() + RIM_PX * this.unit,
      alpha: RIM_ALPHA,
    });
  }

  private bandWidth(): number {
    return Math.min(BAND_PX * this.unit, BAND_MAX_WORLD);
  }

  private drawEdge({ edge, smoothed, colors }: CountryShape): void {
    edge.clear();
    const band = this.bandWidth();
    strokeInside(edge, smoothed, { color: colors.outline, width: band });
    strokeInside(edge, smoothed, {
      color: mixColor(colors.outline, 0x000000, SEAM_DARKEN),
      width: band * SEAM_SHARE,
    });
  }

  /** Clans and fallen empires are marked by their borders while the special layer shows their kind. */
  private refreshEmphasis(): void {
    const emphasised = new Set<number>();
    for (const entry of this.ctx.table.values()) {
      const kind = ownerTerritoryKind(entry, this.ctx.countryTypes);
      if (kind !== null && this.shownKinds.has(kind)) emphasised.add(entry.id);
    }
    this.emphasised = emphasised;
    for (const [id, shape] of this.shapes) this.drawEmphasis(id, shape);
    this.applyVisibility();
  }

  private drawEmphasis(id: number, { emphasis, smoothed }: CountryShape): void {
    emphasis.clear();
    if (!this.emphasised.has(id)) return;
    for (const ring of smoothed.flat()) emphasis.poly(ring, true);
    emphasis.stroke({
      color: EMPHASIS_COLOR,
      width: EMPHASIS_GLOW_PX * this.unit,
      alpha: EMPHASIS_GLOW_ALPHA,
      join: "round",
    });
    for (const ring of smoothed.flat()) emphasis.poly(ring, true);
    emphasis.stroke({
      color: EMPHASIS_COLOR,
      width: EMPHASIS_PX * this.unit,
      join: "round",
    });
  }

  private placeEmblem(id: number, shape: CountryShape): void {
    shape.badges.visible = this.badged(id) && !this.ctx.hiddenCountries.has(id);
    if (!shape.badges.visible) return;
    const entry = this.ctx.table.get(id);
    const clan = entry?.kind === "marauder_clan";
    const key = clan ? null : symbolKey(entry?.country?.flag_icon);
    if (key === null) this.emblemKeys.delete(id);
    else this.emblemKeys.set(id, key);
    const texture = key === null ? null : getTexture(key);
    if (key !== null && texture === undefined) requestTextures([key]);
    shape.art = clan || Boolean(texture);
    for (const piece of shape.pieces) {
      piece.label.tint = clan ? entry.colors.outline : 0xffffff;
      piece.emblem.visible = !clan && Boolean(texture);
      piece.glyph.visible = clan;
      if (clan) piece.glyph.tint = entry.colors.outline;
      if (texture) piece.emblem.texture = texture;
    }
  }

  /**
   * Every shown piece's emblem over its name, as large as fits inside the piece up to the cap,
   * with no two empires' labels overlapping. A piece too small for the game's narrowest name
   * gets that size and overflows; a label crowded out even at half that size is left out.
   */
  private layoutLabels(): void {
    const requests: LabelRequest[] = [];
    const pieces: PieceBadge[] = [];
    for (const shape of this.shapes.values()) {
      shape.scans.forEach((scan, i) => {
        const piece = shape.pieces[i];
        const request = shape.badges.visible ? this.requestOf(piece, scan, shape.art) : null;
        if (request === null) {
          piece.badge.visible = false;
          return;
        }
        requests.push(request);
        pieces.push(piece);
      });
    }
    placeLabels(requests).forEach((fit, k) => this.placePiece(pieces[k], requests[k].shape, fit));
  }

  /**
   * The piece's label per unit of font size, from the cap down to the smallest font size the
   * name takes.
   */
  private requestOf({ label }: PieceBadge, scan: PieceScan, art: boolean): LabelRequest | null {
    label.scale.set(1, 1);
    const shape = {
      nameWidth: label.width / LABEL_FONT_PX,
      nameHeight: label.height / LABEL_FONT_PX,
      emblem: art ? EMBLEM_SIZE : 0,
      drop: art ? EMBLEM_DROP : 0,
    };
    if (!(shape.nameWidth > 0 && shape.nameHeight > 0)) return null;
    const narrowest = this.ctx.border.name_min_width * NAME_MIN_WIDTH_SHARE;
    const floor = Math.min(LABEL_FLOOR_MAX_SIZE, narrowest / shape.nameWidth);
    return { scan, shape, maxScale: LABEL_MAX_SIZE, minScale: floor };
  }

  private placePiece(piece: PieceBadge, shape: LabelShape, fit: LabelFit | null): void {
    const { badge, emblem, glyph, label } = piece;
    badge.visible = fit !== null;
    if (fit === null) return;
    badge.position.set(fit.x, fit.y);
    const ratio = fit.scale / LABEL_FONT_PX;
    label.scale.set(SAVE_X_SIGN * ratio, SAVE_Y_SIGN * ratio);
    label.position.set(0, 0);
    const diameter = shape.emblem * fit.scale;
    if (diameter === 0) return;
    const centre = SAVE_Y_SIGN * (shape.drop * fit.scale - diameter / 2);
    glyph.position.set(0, centre);
    emblem.position.set(0, centre);
    const k = diameter / GLYPH_FONT_PX;
    glyph.scale.set(SAVE_X_SIGN * k, SAVE_Y_SIGN * k);
    emblem.scale.set(
      (SAVE_X_SIGN * diameter) / (emblem.texture.width || 1),
      (SAVE_Y_SIGN * diameter) / (emblem.texture.height || 1),
    );
  }

  /** Every name redrawn in the face that just loaded or dropped, and refitted to its piece. */
  private onFontChanged(): void {
    this.labelStyle = nameStyle();
    for (const [id, shape] of this.shapes) {
      for (const piece of shape.pieces) piece.label.style = this.labelStyle;
      this.placeEmblem(id, shape);
    }
    this.layoutLabels();
  }

  private onTexturesLanded(keys: string[]): void {
    const settled = new Set(keys);
    let landed = false;
    for (const [id, key] of this.emblemKeys) {
      if (!settled.has(key)) continue;
      const shape = this.shapes.get(id);
      if (shape) this.placeEmblem(id, shape);
      landed ||= shape !== undefined;
    }
    if (landed) this.layoutLabels();
  }

  private retext(id: number, shape: CountryShape): void {
    const text = this.ctx.table.get(id)?.label ?? "";
    for (const piece of shape.pieces) if (piece.label.text !== text) piece.label.text = text;
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
