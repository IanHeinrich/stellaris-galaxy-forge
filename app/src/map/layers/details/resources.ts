import type { SystemDetails } from "../../../generated/SystemDetails";
import {
  formatAmount,
  resourceAbbrev,
  resourceChips,
  resourceLabel,
  type ResourceRow,
  resourceStride,
} from "../../../lib/details/resources";
import type { Names } from "../../../lib/names";
import { MAP_FONT } from "../../../lib/visual/style";
import type { Textures } from "./cell";
import type { Row, RowTextStyle } from "./Row";

/** A resource's icon, and its amount's text under it, in screen pixels. */
export const RESOURCE_ICON_PX = 15;
export const RESOURCE_AMOUNT_PX = 11;
/** A resource icon's drop shadow: the icon in black, this far down and right, at this alpha. */
export const ICON_SHADOW_OFFSET_PX = 1;
export const ICON_SHADOW_ALPHA = 0.6;
/** How far below the icon's top the abbreviation that stands in for a missing icon starts. */
const ABBREV_TOP_PX = 3;
/** The least space between two neighbouring cells' texts, so amounts never run together. */
export const RESOURCE_TEXT_GAP_PX = 3;
const AMOUNT_STYLE = { fontFamily: MAP_FONT, fontSize: RESOURCE_AMOUNT_PX, fill: 0xffffff };

/**
 * One resource's cell in a row, in screen pixels: the icon's top-left corner and side, and the
 * tops of the abbreviation standing in for the icon and of the amount under it, both centred
 * on `x`.
 */
export interface ResourceCell {
  readonly x: number;
  readonly iconX: number;
  readonly iconY: number;
  readonly size: number;
  readonly abbrevY: number;
  readonly amountY: number;
}

/** The cell centred on `x` whose top is `top`. */
export function resourceCell(x: number, top: number): ResourceCell {
  return {
    x,
    iconX: x - RESOURCE_ICON_PX / 2,
    iconY: top,
    size: RESOURCE_ICON_PX,
    abbrevY: top + ABBREV_TOP_PX,
    amountY: top + RESOURCE_ICON_PX,
  };
}

/** The text styles of a resource row: its abbreviations in the row's own text style when unset. */
export interface ResourceStyles {
  readonly abbrev?: RowTextStyle;
  readonly amount: RowTextStyle;
}

const RESOURCE_STYLES: ResourceStyles = { amount: AMOUNT_STYLE };

/** How far a drawn resource row reaches either side of its middle, and down from its top. */
export interface ResourceReach {
  readonly half: number;
  readonly height: number;
}

/** A text placed in the row, and how wide it came out. */
interface PlacedText {
  readonly mark: number;
  readonly width: number;
}

/** What a cell needs of its neighbours: its widest text, and the whole cell's width. */
export interface CellWidth {
  readonly text: number;
  readonly wide: number;
}

/**
 * Where the cells of a row stand, centred across x = 0 on the first and last cells. Neighbours
 * keep the game's stride unless their texts would come within `RESOURCE_TEXT_GAP_PX` of each other, so a
 * row of short amounts stays dense and a row of long ones spreads out.
 */
export function resourceCentres(cells: readonly CellWidth[]): { xs: number[]; half: number } {
  if (cells.length === 0) return { xs: [], half: 0 };
  const stride = resourceStride(cells.length);
  const xs = [0];
  for (let i = 1; i < cells.length; i++) {
    const apart = (cells[i - 1].text + cells[i].text) / 2 + RESOURCE_TEXT_GAP_PX;
    xs.push(xs[i - 1] + Math.max(stride, apart));
  }
  const middle = xs[xs.length - 1] / 2;
  const centred = xs.map((x) => x - middle);
  const half = Math.max(...centred.map((x, i) => Math.abs(x) + cells[i].wide / 2));
  return { xs: centred, half };
}

/**
 * Each resource's icon over its amount, centred across x = 0 with its top at `top`, the icon's
 * abbreviation standing in where the icon cannot load.
 */
export function resourceIcons(
  row: Row,
  names: Names,
  tex: Textures,
  rows: readonly ResourceRow[],
  top: number,
  styles: ResourceStyles = RESOURCE_STYLES,
): ResourceReach {
  const placed = rows.map((r) => {
    const texture = tex.texture(r.sprite);
    const title = names.get(r.resource) ?? resourceLabel(r.resource);
    const amount = formatAmount(r.amount);
    const tip = { title, lines: [`+${amount} ${title}`] };
    const cell = resourceCell(0, top);
    let abbrev: PlacedText | null = null;
    if (texture === null) {
      const width = row.text(resourceAbbrev(r.resource), 0, cell.abbrevY, tip, styles.abbrev);
      abbrev = { mark: row.lastTextMark(), width };
    }
    const width = row.text(amount, 0, cell.amountY, tip, styles.amount);
    const text = Math.max(width, abbrev?.width ?? 0);
    return {
      texture,
      tip,
      abbrev,
      amount: { mark: row.lastTextMark(), width },
      cell: { text, wide: Math.max(cell.size, text) },
      height: cell.amountY - top + row.lastTextHeight(),
    };
  });
  const { xs, half } = resourceCentres(placed.map((p) => p.cell));
  let height = 0;
  for (const [i, p] of placed.entries()) {
    const cell = resourceCell(xs[i], top);
    if (p.texture) {
      row.shadow(p.texture, cell.iconX, cell.iconY, cell.size);
      row.sprite(p.texture, cell.iconX, cell.iconY, cell.size, p.tip);
    }
    if (p.abbrev) row.moveText(p.abbrev.mark, cell.x - p.abbrev.width / 2);
    row.moveText(p.amount.mark, cell.x - p.amount.width / 2);
    height = Math.max(height, p.height);
  }
  return { half, height };
}

/** The totals as one line of chips, for a row drawn without game data. */
export function resourceText(row: Row, d: SystemDetails, resourceY: number): void {
  const chips = resourceChips(d);
  if (chips === "") return;
  const w = row.text(chips, 0, resourceY);
  row.nudgeLastText(-w / 2);
}
