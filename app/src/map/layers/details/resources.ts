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

/** A resource's cell in a row: its icon, and its amount's text under it, in screen pixels. */
export const RESOURCE_ICON_PX = 15;
export const RESOURCE_AMOUNT_PX = 11;
const AMOUNT_STYLE = { fontFamily: MAP_FONT, fontSize: RESOURCE_AMOUNT_PX, fill: 0xffffff };

/** The centre of cell `i` of a row of `count`, across from the row's middle. */
export function resourceCellX(i: number, count: number): number {
  return (i - (count - 1) / 2) * resourceStride(count);
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
    const cx = resourceCellX(i, rows.length);
    const texture = tex.texture(r.sprite);
    const title = names.get(r.resource) ?? resourceLabel(r.resource);
    const amount = formatAmount(r.amount);
    const tip = { title, lines: [`+${amount} ${title}`] };
    const ix = cx - RESOURCE_ICON_PX / 2;
    if (texture) {
      row.shadow(texture, ix, resourceY, RESOURCE_ICON_PX);
      row.sprite(texture, ix, resourceY, RESOURCE_ICON_PX, tip);
    } else if (texture === null) {
      const w = row.text(resourceAbbrev(r.resource), cx, resourceY + 3, tip);
      row.nudgeLastText(-w / 2);
    }
    const w = row.text(amount, cx, resourceY + RESOURCE_ICON_PX, tip, AMOUNT_STYLE);
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
