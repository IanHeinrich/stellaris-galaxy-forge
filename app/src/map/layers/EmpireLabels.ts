import { BitmapText, Container, Sprite, TextStyle, Ticker } from "pixi.js";
import { SAVE_X_SIGN, SAVE_Y_SIGN, clamp } from "../../lib/geometry/geometry";
import {
  placeLabels,
  type LabelFit,
  type LabelRequest,
  type LabelShape,
  type PieceScan,
} from "../../lib/geometry/labelFit";
import { EMPIRE_LABEL_MAX_SCALE } from "../../lib/visual/labels";
import { hasGameMapFont, mapNameFamily, onMapNameFont } from "../../lib/visual/mapFont";
import { MAP_FONT } from "../../lib/visual/style";
import { symbolKey } from "../../lib/visual/specialStyle";
import { getTexture, onTextures, requestTextures } from "../../lib/visual/textures";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";

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
/**
 * As in the game, empire names wait a moment once the camera closes past the threshold, then fade
 * out slowly. Zooming back out before then cancels the fade; after it they fade back in quickly.
 */
const FADE_OUT_DELAY_MS = 1200;
const FADE_OUT_MS = 800;
const FADE_IN_MS = 450;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One territory piece's emblem and name. */
interface PieceBadge {
  badge: Container;
  emblem: Sprite;
  /** A clan's emblem, in the outline colour like its name; hidden for a country. */
  glyph: BitmapText;
  label: BitmapText;
}

/** One owner's badges: the game labels every separate piece of its region. */
interface OwnerBadges {
  badges: Container;
  /** Each piece of the owner's region, scanned for room for its label. */
  scans: PieceScan[];
  pieces: PieceBadge[];
  /** Whether the badges show an emblem or a clan's glyph above the name. */
  art: boolean;
}

/**
 * The empire names and emblems over the territories, above the lanes and stars as in the game:
 * a badge on each piece of an owner's region, fitted to the room the piece has, in the face the
 * map names use. They fade out a moment after system names appear.
 */
export class EmpireLabels {
  readonly container = new Container({ label: "badges" });
  private ctx: RenderContext = EMPTY_CONTEXT;
  private readonly owners = new Map<number, OwnerBadges>();
  private readonly emblemKeys = new Map<number, string>();
  private labelStyle = nameStyle();
  private shown = true;
  private fade = 1;
  private fadeTarget = 1;
  /** How long the names have waited to fade out since the camera passed the threshold. */
  private fadeWaited = 0;
  private fading = false;
  private readonly unsubscribeTextures: () => void;
  private readonly unsubscribeFont: () => void;

  constructor() {
    this.unsubscribeTextures = onTextures((keys) => this.onTexturesLanded(keys));
    this.unsubscribeFont = onMapNameFont(() => this.onFontChanged());
  }

  setContext(ctx: RenderContext): void {
    this.ctx = ctx;
  }

  setShown(v: boolean): void {
    this.shown = v;
    this.applyVisibility();
  }

  onViewport(scale: number): void {
    if (this.shown) this.fadeTowards(scale < EMPIRE_LABEL_MAX_SCALE ? 1 : 0);
  }

  /** Gives owner `id` a badge on each of `scans`, in its name and emblem. */
  set(id: number, scans: PieceScan[]): void {
    let owner = this.owners.get(id);
    if (!owner) {
      const badges = new Container();
      badges.visible = false;
      owner = { badges, scans, pieces: [], art: false };
      this.container.addChild(badges);
      this.owners.set(id, owner);
    }
    owner.scans = scans;
    this.matchPieces(owner);
    this.retext(id, owner);
    this.placeEmblem(id, owner);
  }

  remove(id: number): void {
    const owner = this.owners.get(id);
    if (!owner) return;
    owner.badges.destroy({ children: true });
    this.owners.delete(id);
    this.emblemKeys.delete(id);
  }

  retextAll(): void {
    for (const [id, owner] of this.owners) this.retext(id, owner);
  }

  placeAll(): void {
    for (const [id, owner] of this.owners) this.placeEmblem(id, owner);
  }

  refreshVisibility(): void {
    for (const [id, owner] of this.owners) this.applyBadgeVisibility(id, owner);
  }

  /**
   * Every shown piece's emblem over its name, as large as fits inside the piece up to the cap,
   * with no two empires' labels overlapping. A piece too small for the game's narrowest name
   * gets that size and overflows; a label crowded out even at half that size is left out.
   */
  layout(): void {
    const requests: LabelRequest[] = [];
    const pieces: PieceBadge[] = [];
    for (const owner of this.owners.values()) {
      owner.scans.forEach((scan, i) => {
        const piece = owner.pieces[i];
        const request = owner.badges.visible ? this.requestOf(piece, scan, owner.art) : null;
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

  destroy(): void {
    this.unsubscribeTextures();
    this.unsubscribeFont();
    Ticker.shared.remove(this.fadeTick, this);
    this.container.destroy({ children: true });
  }

  private applyVisibility(): void {
    this.container.visible = this.shown && this.fade > 0;
  }

  /** Every owner in the table shows its emblem and name on each piece, unless its eye is off. */
  private badgesShown(id: number): boolean {
    return this.ctx.table.has(id) && !this.ctx.hiddenCountries.has(id);
  }

  private applyBadgeVisibility(id: number, owner: OwnerBadges): boolean {
    owner.badges.visible = this.badgesShown(id);
    return owner.badges.visible;
  }

  /** As many piece badges as the owner has pieces. */
  private matchPieces(owner: OwnerBadges): void {
    while (owner.pieces.length > owner.scans.length) {
      owner.pieces.pop()?.badge.destroy({ children: true });
    }
    while (owner.pieces.length < owner.scans.length) {
      const text = owner.pieces[0]?.label.text ?? "";
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
      owner.badges.addChild(badge);
      owner.pieces.push({ badge, emblem, glyph, label });
    }
  }

  private retext(id: number, owner: OwnerBadges): void {
    const text = this.ctx.table.get(id)?.label ?? "";
    for (const piece of owner.pieces) if (piece.label.text !== text) piece.label.text = text;
  }

  private placeEmblem(id: number, owner: OwnerBadges): void {
    if (!this.applyBadgeVisibility(id, owner)) return;
    const entry = this.ctx.table.get(id);
    const clan = entry?.kind === "marauder_clan";
    const key = clan ? null : symbolKey(entry?.country?.flag_icon);
    if (key === null) this.emblemKeys.delete(id);
    else this.emblemKeys.set(id, key);
    const texture = key === null ? null : getTexture(key);
    if (key !== null && texture === undefined) requestTextures([key]);
    owner.art = clan || Boolean(texture);
    for (const piece of owner.pieces) {
      piece.label.tint = clan ? entry.colors.outline : 0xffffff;
      piece.emblem.visible = !clan && Boolean(texture);
      piece.glyph.visible = clan;
      if (clan) piece.glyph.tint = entry.colors.outline;
      if (texture) piece.emblem.texture = texture;
    }
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
    for (const [id, owner] of this.owners) {
      for (const piece of owner.pieces) piece.label.style = this.labelStyle;
      this.placeEmblem(id, owner);
    }
    this.layout();
  }

  private onTexturesLanded(keys: string[]): void {
    const settled = new Set(keys);
    let landed = false;
    for (const [id, key] of this.emblemKeys) {
      if (!settled.has(key)) continue;
      const owner = this.owners.get(id);
      if (owner) this.placeEmblem(id, owner);
      landed ||= owner !== undefined;
    }
    if (landed) this.layout();
  }

  private fadeTowards(target: number): void {
    if (target === this.fadeTarget) return;
    this.fadeTarget = target;
    this.fadeWaited = 0;
    if (!this.fading) {
      this.fading = true;
      Ticker.shared.add(this.fadeTick, this);
    }
  }

  private fadeTick(ticker: Ticker): void {
    const out = this.fadeTarget < this.fade;
    if (out && this.fadeWaited < FADE_OUT_DELAY_MS) {
      this.fadeWaited += ticker.deltaMS;
      return;
    }
    const step = ticker.deltaMS / (out ? FADE_OUT_MS : FADE_IN_MS);
    this.fade = clamp(this.fade + (out ? -step : step), 0, 1);
    this.container.alpha = smoothstep(this.fade);
    this.applyVisibility();
    if (this.fade === this.fadeTarget) {
      this.fading = false;
      Ticker.shared.remove(this.fadeTick, this);
    }
  }
}
