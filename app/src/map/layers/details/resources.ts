import type { SystemDetails } from "../../../generated/SystemDetails";
import {
  formatAmount,
  resourceAbbrev,
  resourceChips,
  resourceLabel,
  resourceRows,
  resourceStride,
} from "../../../lib/details/resources";
import { MAP_FONT } from "../../../lib/visual/style";
import type { RenderContext } from "../../RenderContext";
import type { Textures } from "./cell";
import type { Row } from "./Row";

/** A resource's icon, and its amount's text under it, in screen pixels. */
export const RESOURCE_ICON_PX = 15;
export const RESOURCE_AMOUNT_PX = 11;
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

export function resourceIcons(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  d: SystemDetails,
  resourceY: number,
): void {
  const { resourceIcons, names } = ctx;
  const rows = resourceRows(d, resourceIcons);
  for (const [i, r] of rows.entries()) {
    const cell = resourceCell(i, rows.length, resourceY);
    const texture = tex.texture(r.sprite);
    const title = names.get(r.resource) ?? resourceLabel(r.resource);
    const amount = formatAmount(r.amount);
    const tip = { title, lines: [`+${amount} ${title}`] };
    if (texture) {
      row.shadow(texture, cell.iconX, cell.iconY, cell.size);
      row.sprite(texture, cell.iconX, cell.iconY, cell.size, tip);
    } else if (texture === null) {
      const w = row.text(resourceAbbrev(r.resource), cell.x, cell.abbrevY, tip);
      row.nudgeLastText(-w / 2);
    }
    const w = row.text(amount, cell.x, cell.amountY, tip, AMOUNT_STYLE);
    row.nudgeLastText(-w / 2);
  }
}

/** The totals as one line of chips, for a row drawn without game data. */
export function resourceText(row: Row, d: SystemDetails, resourceY: number): void {
  const chips = resourceChips(d);
  if (chips === "") return;
  const w = row.text(chips, 0, resourceY);
  row.nudgeLastText(-w / 2);
}
