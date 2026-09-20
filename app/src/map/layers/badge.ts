import { BitmapText, Container, Graphics, Sprite, type Texture, TextStyle } from "pixi.js";
import type { BadgeGeometry, BadgeSide } from "../../lib/visual/specialStyle";
import { MAP_FONT } from "../../lib/visual/style";
import { getTexture, requestTextures } from "../../lib/visual/textures";

export const RING_RADIUS = 15;
const RING_WIDTH = 1.5;
const RING_ALPHA = 0.9;
const HALO_ALPHA = 0.35;
const HALO_FRINGE = 6;
const HALO_FRINGE_ALPHA = 0.12;
const PLATE_COLOR = 0x0b0f14;
const PLATE_ALPHA = 0.85;
const PLATE_BORDER = 1.5;
/** The plate's near corner sits this far outside the ring, on the diagonal. */
const CORNER_GAP = 4;
const LEADER_WIDTH = 1.5;
const LEADER_ALPHA = 0.8;
const DOT_RADIUS = 5;
const ICON_ALPHA = 0.95;
const TEXT_STROKE = { color: PLATE_COLOR, width: 2 };

function textStyle(size: number): TextStyle {
  return new TextStyle({
    fontFamily: MAP_FONT,
    fontSize: size,
    fill: 0xffffff,
    stroke: TEXT_STROKE,
  });
}

/** One instance per size: PixiJS keys a stroked dynamic bitmap font by the style object. */
const TEXT_STYLES = new Map<number, TextStyle>();

export function badgeTextStyle(geo: BadgeGeometry): TextStyle {
  let style = TEXT_STYLES.get(geo.font);
  if (!style) {
    style = textStyle(geo.font);
    TEXT_STYLES.set(geo.font, style);
  }
  return style;
}

/** The far side, so a bypass badge clears the point-of-interest badge on the same star. */
export function otherSide(side: BadgeSide): BadgeSide {
  return side === "above" ? "below" : "above";
}

/** A badge's icon, asking for the art the first time it is wanted; null until it lands. */
export function badgeTexture(key: string): Texture | null {
  requestTextures([key]);
  return getTexture(key) ?? null;
}

/** One system's marker: halo and ring on the star, a plate with icon and label led off it. */
export class Badge {
  readonly root = new Container();
  readonly halo = new Graphics();
  readonly ring = new Graphics();
  readonly leader = new Graphics();
  readonly plate = new Graphics();
  readonly icon = new Sprite();
  readonly dot = new Graphics();
  readonly text: BitmapText;

  constructor(geo: BadgeGeometry) {
    this.root.eventMode = "passive";
    this.text = new BitmapText({ text: "", style: badgeTextStyle(geo) });
    this.text.anchor.set(0, 0.5);
    this.icon.anchor.set(0.5, 0.5);
    this.icon.alpha = ICON_ALPHA;
    for (const c of [this.halo, this.ring, this.leader, this.icon, this.dot, this.text]) {
      c.eventMode = "none";
    }
    this.plate.eventMode = "static";
    this.plate.cursor = "help";
    this.root.addChild(
      this.halo,
      this.ring,
      this.leader,
      this.plate,
      this.icon,
      this.dot,
      this.text,
    );
  }

  setIcon(texture: Texture | null, size: number, color: number): void {
    this.icon.visible = texture !== null;
    this.dot.visible = texture === null;
    if (texture) {
      this.icon.texture = texture;
      const k = size / Math.max(texture.width, texture.height, 1);
      this.icon.scale.set(k);
    } else {
      this.dot.clear().circle(0, 0, DOT_RADIUS).fill({ color });
    }
  }

  /** `slot` stacks a second badge on one star further out along the same diagonal. */
  layout(geo: BadgeGeometry, side: BadgeSide, color: number, ringPx: number, slot = 0): void {
    const w = geo.pad + geo.icon + geo.gap + this.text.width + geo.pad;
    const h = geo.icon + 2 * geo.pad;
    const corner = ringPx * Math.SQRT1_2 + CORNER_GAP;
    const up = side === "above" ? -1 : 1;
    const near = up * (corner + slot * (h + geo.gap));
    const x0 = corner;
    const y0 = side === "above" ? near - h : near;
    const edge = ringPx * Math.SQRT1_2;
    this.leader
      .clear()
      .moveTo(edge, up * edge)
      .lineTo(corner, up * corner)
      .lineTo(corner, near)
      .stroke({ color, width: LEADER_WIDTH, alpha: LEADER_ALPHA });
    this.plate
      .clear()
      .roundRect(x0, y0, w, h, geo.radius)
      .fill({ color: PLATE_COLOR, alpha: PLATE_ALPHA })
      .stroke({ color, width: PLATE_BORDER, alpha: 1 });
    const cy = y0 + h / 2;
    const iconX = x0 + geo.pad + geo.icon / 2;
    this.icon.position.set(iconX, cy);
    this.dot.position.set(iconX, cy);
    this.text.position.set(x0 + geo.pad + geo.icon + geo.gap, cy);
    this.halo.clear();
    if (geo.halo > 0) {
      this.halo
        .circle(0, 0, geo.halo + HALO_FRINGE)
        .fill({ color, alpha: HALO_FRINGE_ALPHA })
        .circle(0, 0, geo.halo)
        .fill({ color, alpha: HALO_ALPHA });
    }
    this.ring
      .clear()
      .circle(0, 0, RING_RADIUS)
      .stroke({ color, width: RING_WIDTH, alpha: RING_ALPHA });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
