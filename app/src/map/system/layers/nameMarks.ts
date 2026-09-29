import type { Container, NineSliceSprite } from "pixi.js";
import { PLATE_BORDER_PX } from "../../../lib/details/icons";
import {
  type BodyMarks,
  type Box,
  NAME_ROW,
  PLATE_PAD_PX,
  plateBox,
} from "../../../lib/details/layout";
import { DISC_PX, rowAt, type Textures } from "../../layers/details/cell";
import type { Tip } from "../../layers/details/Hover";
import { iconsWidth } from "../../layers/details/icons";
import { drawNameIcons, nameIcons } from "../../layers/details/nameIcons";
import { fitPlate, namePlate } from "../../layers/details/namePlate";
import { emblemFlag, type FlagContext, flagBox } from "../../layers/details/ownerFlag";
import { LabelRow } from "./labelRow";

/** The galaxy's name row with its top at 0, in its own pixels. */
const ROW_Y = rowAt(0);
/** The galaxy's plate about that row, whose proportions the game plate keeps. */
const FRAME = plateBox(0, ROW_Y.row);
/** The flag with its capital's rim, the tallest mark; the icons' discs are centred on the same line. */
const MARK = flagBox(0, ROW_Y);

/**
 * The game's plate, the owner's flag and the icons of a body's megastructures, dig sites,
 * anomaly and pre-FTL civilisation about its name plate, drawn as the galaxy's Details layer
 * draws them about a system's name. The flag and the icons are scaled to the plate's height and
 * hang outside it, left and right, so the name stands where it does without them.
 */
export class NameMarks {
  /** How far the marks reach past either side of the plate, in the label's unscaled pixels. */
  readonly side: number;
  /** The game's plate, to stand under the name's own; null for a body that is not a colony. */
  readonly under: NineSliceSprite | null;
  /** The flag and the icons, to stand over the plates. */
  readonly over: Container;
  private readonly row = new LabelRow("marks");
  /** The label's pixels per galaxy row pixel, for the flag and the icons. */
  private readonly scale: number;
  /** The same for the game plate, small enough that its faded ends fit a short name's plate. */
  private readonly plateScale: number;
  private readonly flagRight: number;
  private readonly iconX: number;

  /** Room for `marks` about a plate `w` by `h` in the label's unscaled pixels. */
  constructor(
    marks: BodyMarks,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.scale = h / MARK.height;
    this.plateScale = Math.min(h / FRAME.height, w / (2 * PLATE_BORDER_PX));
    const half = w / (2 * this.scale) - PLATE_PAD_PX;
    const plate = plateBox(half, ROW_Y.row);
    this.flagRight = -half - NAME_ROW.gap;
    this.iconX = half + NAME_ROW.gap;
    const boxes: Box[] = [plate];
    if (marks.emblem?.flag) boxes.push(flagBox(this.flagRight, ROW_Y));
    const icons = marks.slots.length;
    if (icons > 0) {
      boxes.push({ x: this.iconX, y: ROW_Y.disc, width: iconsWidth(icons), height: DISC_PX });
    }
    const left = plate.x - Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width)) - plate.x - plate.width;
    this.side = Math.max(left, right) * this.scale;
    this.under = marks.emblem?.plate ? namePlate() : null;
    if (this.under) {
      this.under.label = "gamePlate";
      this.under.scale.set(this.plateScale);
    }
    this.over = this.row.root;
    this.over.scale.set(this.scale);
  }

  /** Stands the marks about the plate whose top-left corner is at (x, y) in the label. */
  place(x: number, y: number): void {
    this.under?.position.set(x, y);
    const middle = MARK.y + MARK.height / 2;
    this.over.position.set(x + this.w / 2, y + this.h / 2 - middle * this.scale);
  }

  /**
   * Draws `marks`, which read as those the marks were built for, with what has landed of `tex`,
   * each icon's glyph where its texture cannot load, and tooltips as `ctx` reads them.
   */
  dress(tex: Textures, marks: BodyMarks, ctx: FlagContext): void {
    const { under } = this;
    const row = this.row.row;
    const plate = marks.emblem?.plate;
    if (under && plate) {
      const texture = tex.texture(plate);
      under.visible = Boolean(texture);
      if (texture) {
        const k = this.plateScale;
        fitPlate(under, texture, { x: 0, y: 0, width: this.w / k, height: this.h / k });
      }
    }
    row.begin();
    if (marks.emblem) {
      emblemFlag(row, ctx, tex, marks.emblem, marks.icons.planets, this.flagRight, ROW_Y);
    }
    drawNameIcons(row, tex, nameIcons(ctx, tex, marks.icons), this.iconX, ROW_Y);
    row.end();
  }

  /** The tooltip of the mark at (x, y) in the label's unscaled pixels; null for none. */
  tipAt(x: number, y: number): Tip | null {
    return this.row.tipAt(x, y);
  }
}
