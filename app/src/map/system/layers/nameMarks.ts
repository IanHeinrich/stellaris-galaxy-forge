import type { Container, NineSliceSprite } from "pixi.js";
import { PLATE_BORDER_PX, PRE_FTL_ICON } from "../../../lib/details/icons";
import {
  type BodyMarks,
  type Box,
  NAME_ROW,
  PLATE_PAD_PX,
  plateBox,
} from "../../../lib/details/layout";
import { DISC_PX, rowAt, type Textures } from "../../layers/details/cell";
import { Hover } from "../../layers/details/Hover";
import { icon } from "../../layers/details/icons";
import { fitPlate, namePlate } from "../../layers/details/namePlate";
import { flag, flagBox } from "../../layers/details/ownerFlag";
import { Row } from "../../layers/details/Row";

/** The galaxy's name row with its top at 0, in its own pixels. */
const ROW_Y = rowAt(0);
/** The galaxy's plate about that row, whose proportions the game plate keeps. */
const FRAME = plateBox(0, ROW_Y.row);
/** The flag with its capital's rim, the tallest mark; the pre-FTL disc is centred on the same line. */
const MARK = flagBox(0, ROW_Y);
/** The marks draw no tooltips, so every row shares one hover that never holds an item. */
const NO_HOVER = new Hover();

/**
 * The game's plate, the owner's flag and the pre-FTL icon about a body's name plate, drawn as the
 * galaxy's Details layer draws them about a system's name. The flag and the icon are scaled to the
 * plate's height and hang outside it, left and right, so the name stands where it does without
 * them.
 */
export class NameMarks {
  /** How far the marks reach past either side of the plate, in the label's unscaled pixels. */
  readonly side: number;
  /** The game's plate, to stand under the name's own; null for a body that is not a colony. */
  readonly under: NineSliceSprite | null;
  /** The flag and the icon, to stand over the plates. */
  readonly over: Container;
  private readonly row = new Row(NO_HOVER);
  /** The label's pixels per galaxy row pixel, for the flag and the icon. */
  private readonly scale: number;
  /** The same for the game plate, small enough that its faded ends fit a short name's plate. */
  private readonly plateScale: number;
  private readonly flagRight: number;
  private readonly iconX: number;

  /** Marks about a plate `w` by `h` in the label's unscaled pixels. */
  constructor(
    readonly marks: BodyMarks,
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
    if (marks.flag !== null) boxes.push(flagBox(this.flagRight, ROW_Y));
    if (marks.preFtl) {
      boxes.push({ x: this.iconX, y: ROW_Y.disc, width: DISC_PX, height: DISC_PX });
    }
    const left = plate.x - Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width)) - plate.x - plate.width;
    this.side = Math.max(left, right) * this.scale;
    this.under = marks.plate === null ? null : namePlate();
    if (this.under) {
      this.under.label = "gamePlate";
      this.under.scale.set(this.plateScale);
    }
    this.over = this.row.root;
    this.over.label = "marks";
    this.over.eventMode = "none";
    this.over.scale.set(this.scale);
  }

  /** Stands the marks about the plate whose top-left corner is at (x, y) in the label. */
  place(x: number, y: number): void {
    this.under?.position.set(x, y);
    const middle = MARK.y + MARK.height / 2;
    this.over.position.set(x + this.w / 2, y + this.h / 2 - middle * this.scale);
  }

  /** Draws what has landed of `tex`, the icon's glyph where its texture cannot load. */
  dress(tex: Textures): void {
    const { marks, under, row } = this;
    if (under && marks.plate !== null) {
      const texture = tex.texture(marks.plate);
      under.visible = Boolean(texture);
      if (texture) {
        const k = this.plateScale;
        fitPlate(under, texture, { x: 0, y: 0, width: this.w / k, height: this.h / k });
      }
    }
    row.begin();
    const texture = marks.flag === null ? null : tex.texture(marks.flag);
    if (texture) flag(row, texture, this.flagRight, ROW_Y, marks.capital, null);
    if (marks.preFtl) icon(row, tex, PRE_FTL_ICON, this.iconX, ROW_Y, null);
    row.end();
  }
}
