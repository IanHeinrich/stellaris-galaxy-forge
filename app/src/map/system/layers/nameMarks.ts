import type { Container, NineSliceSprite } from "pixi.js";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { type Icon, PLATE_BORDER_PX } from "../../../lib/details/icons";
import {
  type BodyMarks,
  type Box,
  NAME_ROW,
  PLATE_PAD_PX,
  plateBox,
} from "../../../lib/details/layout";
import type { Ownership } from "../../../lib/ownership";
import { DISC_PX, NO_TEXTURES, rowAt, type Textures } from "../../layers/details/cell";
import type { Tip } from "../../layers/details/Hover";
import { iconsWidth } from "../../layers/details/icons";
import { drawNameIcons, type NameIconSubject, nameIcons } from "../../layers/details/nameIcons";
import { fitPlate, namePlate } from "../../layers/details/namePlate";
import { flag, flagBox } from "../../layers/details/ownerFlag";
import { type PlanetLineContext, planetLines } from "../../layers/details/planets";
import { LabelRow } from "./labelRow";

/** The galaxy's name row with its top at 0, in its own pixels. */
const ROW_Y = rowAt(0);
/** The galaxy's plate about that row, whose proportions the game plate keeps. */
const FRAME = plateBox(0, ROW_Y.row);
/** The flag with its capital's rim, the tallest mark; the icons' discs are centred on the same line. */
const MARK = flagBox(0, ROW_Y);
const NO_BYPASSES: readonly Icon[] = [];

/** What the marks' tooltips read. */
export type NameMarkContext = PlanetLineContext & { readonly ownership: Ownership };

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
  private readonly subject: NameIconSubject;

  /** Marks about the plate of `planet`, `w` by `h` in the label's unscaled pixels. */
  constructor(
    readonly marks: BodyMarks,
    private readonly planet: PlanetSummary,
    private readonly ctx: NameMarkContext,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.subject = {
      planets: [planet],
      megastructures: marks.megastructures,
      bypasses: NO_BYPASSES,
      sites: marks.sites,
      anomaly: marks.anomaly,
    };
    this.scale = h / MARK.height;
    this.plateScale = Math.min(h / FRAME.height, w / (2 * PLATE_BORDER_PX));
    const half = w / (2 * this.scale) - PLATE_PAD_PX;
    const plate = plateBox(half, ROW_Y.row);
    this.flagRight = -half - NAME_ROW.gap;
    this.iconX = half + NAME_ROW.gap;
    const boxes: Box[] = [plate];
    if (marks.flag !== null) boxes.push(flagBox(this.flagRight, ROW_Y));
    const icons = nameIcons(ctx, NO_TEXTURES, this.subject).length;
    if (icons > 0) {
      boxes.push({ x: this.iconX, y: ROW_Y.disc, width: iconsWidth(icons), height: DISC_PX });
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
    this.over.scale.set(this.scale);
  }

  /** Stands the marks about the plate whose top-left corner is at (x, y) in the label. */
  place(x: number, y: number): void {
    this.under?.position.set(x, y);
    const middle = MARK.y + MARK.height / 2;
    this.over.position.set(x + this.w / 2, y + this.h / 2 - middle * this.scale);
  }

  /** Draws what has landed of `tex`, each icon's glyph where its texture cannot load. */
  dress(tex: Textures): void {
    const { marks, under } = this;
    const row = this.row.row;
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
    if (texture) flag(row, texture, this.flagRight, ROW_Y, marks.capital, this.flagTip(tex));
    drawNameIcons(row, tex, nameIcons(this.ctx, tex, this.subject), this.iconX, ROW_Y);
    row.end();
  }

  /** The tooltip of the mark at (x, y) in the label's unscaled pixels; null for none. */
  tipAt(x: number, y: number): Tip | null {
    return this.row.tipAt(x, y);
  }

  private flagTip(tex: Textures): Tip | null {
    const { owner } = this.planet;
    if (owner === null) return null;
    const title = this.ctx.ownership.table.get(owner)?.label ?? this.ctx.countryName(owner);
    return { title, lines: planetLines(this.ctx, tex, [this.planet]) };
  }
}
