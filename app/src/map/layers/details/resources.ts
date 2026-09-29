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

/** Cell `i` of a row of `count` whose top is `top`, across from the row's middle. */
export function resourceCell(i: number, count: number, top: number): ResourceCell {
  const x = (i - (count - 1) / 2) * resourceStride(count);
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
  let half = 0;
  let height = 0;
  for (const [i, r] of rows.entries()) {
    const cell = resourceCell(i, rows.length, top);
    const texture = tex.texture(r.sprite);
    const title = names.get(r.resource) ?? resourceLabel(r.resource);
    const amount = formatAmount(r.amount);
    const tip = { title, lines: [`+${amount} ${title}`] };
    let wide = cell.size;
    if (texture) {
      row.shadow(texture, cell.iconX, cell.iconY, cell.size);
      row.sprite(texture, cell.iconX, cell.iconY, cell.size, tip);
    } else if (texture === null) {
      const w = row.text(resourceAbbrev(r.resource), cell.x, cell.abbrevY, tip, styles.abbrev);
      row.nudgeLastText(-w / 2);
      wide = Math.max(wide, w);
    }
    const w = row.text(amount, cell.x, cell.amountY, tip, styles.amount);
    row.nudgeLastText(-w / 2);
    half = Math.max(half, Math.abs(cell.x) + Math.max(wide, w) / 2);
    height = Math.max(height, cell.amountY - top + row.lastTextHeight());
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
