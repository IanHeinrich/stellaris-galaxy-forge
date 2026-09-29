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
/** The galaxy's plate about that row, whose size a body's name plate takes. */
export const NAME_FRAME = plateBox(0, ROW_Y.row);

/**
 * The game's plate, the owner's flag and the icons of a body's megastructures, dig sites,
 * anomaly and pre-FTL civilisation about its name plate, drawn as the galaxy's Details layer
 * draws them about a system's name, at the same size. The flag and the icons hang outside the
 * plate, left and right, so the name stands where it does along the plate without them.
 */
export class NameMarks {
  /** How far the marks reach past either side of the plate, in the label's unscaled pixels. */
  readonly side: number;
  /** How far they reach above the plate's top, and below its bottom. */
  readonly above: number;
  readonly below: number;
  /** The game's plate, to stand under the name's own; null for a body that is not a colony. */
  readonly under: NineSliceSprite | null;
  /** The flag and the icons, to stand over the plates. */
  readonly over: Container;
  private readonly row = new LabelRow("marks");
  /** The game plate's scale, small enough that its faded ends fit a short name's plate. */
  private readonly plateScale: number;
  private readonly flagRight: number;
  private readonly iconX: number;

  /** Room for `marks` about a plate `w` wide and `NAME_FRAME` tall, in the label's unscaled pixels. */
  constructor(
    marks: BodyMarks,
    private readonly w: number,
  ) {
    this.plateScale = Math.min(1, w / (2 * PLATE_BORDER_PX));
    const half = w / 2 - PLATE_PAD_PX;
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
    this.side = Math.max(left, right);
    this.above = plate.y - Math.min(...boxes.map((b) => b.y));
    this.below = Math.max(...boxes.map((b) => b.y + b.height)) - plate.y - plate.height;
    this.under = marks.emblem?.plate ? namePlate() : null;
    if (this.under) {
      this.under.label = "gamePlate";
      this.under.scale.set(this.plateScale);
    }
    this.over = this.row.root;
  }

  /** Stands the marks about the plate whose top-left corner is at (x, y) in the label. */
  place(x: number, y: number): void {
    this.under?.position.set(x, y);
    this.over.position.set(x + this.w / 2, y - NAME_FRAME.y);
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
        const box = { x: 0, y: 0, width: this.w / k, height: NAME_FRAME.height / k };
        fitPlate(under, texture, box);
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
