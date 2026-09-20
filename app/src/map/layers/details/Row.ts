import { BitmapText, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { MAP_FONT } from "../../../lib/visual/style";
import type { Hover, Item, Tip } from "./Hover";

const TEXT_STYLE = { fontFamily: MAP_FONT, fontSize: 11, fill: 0xd6dde8 };
const SHADOW_ALPHA = 0.6;

interface Style {
  fontFamily: string;
  fontSize: number;
  fill: number;
}

/**
 * One system's details: pooled sprites, texts and marks under a screen-stable root, layered
 * marks < shadows < sprites < texts, sprites stacking in the order they are placed.
 */
export class Row {
  readonly root = new Container();
  readonly marks = new Graphics();
  /** The planet dots drawn without game data, hoverable as one. */
  readonly planetMarks = new Graphics();
  private readonly shadowLayer = new Container();
  private readonly spriteLayer = new Container();
  private readonly textLayer = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly shadows: Sprite[] = [];
  private readonly texts: BitmapText[] = [];
  private readonly textStyles: Style[] = [];
  private usedSprites = 0;
  private usedShadows = 0;
  private usedTexts = 0;

  constructor(private readonly hover: Hover) {
    this.root.eventMode = "passive";
    this.marks.eventMode = "none";
    this.spriteLayer.sortableChildren = true;
    this.hover.bind(this.planetMarks);
    this.root.addChild(
      this.marks,
      this.planetMarks,
      this.shadowLayer,
      this.spriteLayer,
      this.textLayer,
    );
  }

  begin(): void {
    this.usedSprites = 0;
    this.usedShadows = 0;
    this.usedTexts = 0;
    this.marks.clear();
    this.planetMarks.clear();
    this.planetTip(null);
  }

  end(): void {
    for (let i = this.usedSprites; i < this.sprites.length; i++) this.hide(this.sprites[i]);
    for (let i = this.usedShadows; i < this.shadows.length; i++) this.shadows[i].visible = false;
    for (let i = this.usedTexts; i < this.texts.length; i++) this.hide(this.texts[i]);
  }

  release(): void {
    this.root.visible = false;
    this.begin();
    this.end();
  }

  /** The tooltip for the planet dots, which hover as one. */
  planetTip(tip: Tip | null): void {
    this.hover.set(this.planetMarks, tip);
  }

  /** Places `texture` fitted into a `size` square at (x, y), above everything placed before it. */
  sprite(texture: Texture, x: number, y: number, size: number, tip: Tip | null = null): void {
    let s = this.sprites[this.usedSprites];
    if (!s) {
      s = new Sprite();
      this.sprites.push(s);
      this.spriteLayer.addChild(s);
      this.hover.bind(s);
    }
    s.zIndex = this.usedSprites++;
    fit(s, texture, x, y, size);
    this.hover.set(s, tip);
  }

  /** The same texture in black under the sprite that follows, a cheap drop shadow. */
  shadow(texture: Texture, x: number, y: number, size: number): void {
    let s = this.shadows[this.usedShadows];
    if (!s) {
      s = new Sprite();
      s.tint = 0x000000;
      s.alpha = SHADOW_ALPHA;
      s.eventMode = "none";
      this.shadows.push(s);
      this.shadowLayer.addChild(s);
    }
    this.usedShadows++;
    fit(s, texture, x + 1, y + 1, size);
  }

  text(str: string, x: number, y: number, tip: Tip | null = null, style = TEXT_STYLE): number {
    let t = this.texts[this.usedTexts];
    if (!t) {
      t = new BitmapText({ text: "", style });
      this.texts.push(t);
      this.textStyles.push(style);
      this.textLayer.addChild(t);
      this.hover.bind(t);
    }
    if (this.textStyles[this.usedTexts] !== style) {
      this.textStyles[this.usedTexts] = style;
      t.style = style;
    }
    this.usedTexts++;
    if (t.text !== str) t.text = str;
    t.position.set(x, y);
    t.visible = true;
    this.hover.set(t, tip);
    return t.width;
  }

  nudgeLastText(dx: number): void {
    this.texts[this.usedTexts - 1].x += dx;
  }

  private hide(item: Item): void {
    item.visible = false;
    this.hover.set(item, null);
  }
}

function fit(s: Sprite, texture: Texture, x: number, y: number, size: number): void {
  const k = size / Math.max(texture.width, texture.height, 1);
  s.texture = texture;
  s.scale.set(k);
  s.position.set(x + (size - texture.width * k) / 2, y + (size - texture.height * k) / 2);
  s.visible = true;
}
