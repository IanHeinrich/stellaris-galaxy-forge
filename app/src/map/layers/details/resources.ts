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

const AMOUNT_STYLE = { fontFamily: MAP_FONT, fontSize: 11, fill: 0xffffff };
const RESOURCE_ICON_PX = 15;

export function resourceIcons(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  d: SystemDetails,
  resourceY: number,
): void {
  const { resourceIcons, names } = ctx;
  const rows = resourceRows(d, resourceIcons);
  const stride = resourceStride(rows.length);
  let cx = (-rows.length * stride + stride) / 2;
  for (const r of rows) {
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
    cx += stride;
  }
}

/** The totals as one line of chips, for a row drawn without game data. */
export function resourceText(row: Row, d: SystemDetails, resourceY: number): void {
  const chips = resourceChips(d);
  if (chips === "") return;
  const w = row.text(chips, 0, resourceY);
  row.nudgeLastText(-w / 2);
}
