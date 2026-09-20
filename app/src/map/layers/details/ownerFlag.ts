import type { Graphics } from "pixi.js";
import type { SystemDetails } from "../../../generated/SystemDetails";
import type { SystemNode } from "../../../generated/SystemNode";
import { empireFlagKey } from "../../../lib/details/fleets";
import { emblemOwner } from "../../../lib/details/layout";
import type { RenderContext } from "../../RenderContext";
import { DISC_PX, ICON_PX, type RowY, type Textures } from "./cell";
import { planetLines } from "./planets";
import type { Row } from "./Row";

/**
 * The empire flag texture (`compose_empire_flag`) pads a 60 px disc inside a 70 px frame; the
 * sprite is drawn oversized so the disc itself reads at `DISC_PX`, like a row icon's.
 */
const EMBLEM_PX = (DISC_PX * 70) / 60;
const CAPITAL_RIM_PX = 1;
const CAPITAL_RIM_WIDTH = 2;
const CAPITAL_RIM_COLOR = 0xe8c872;

export function ownerFlag(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  s: SystemNode,
  d: SystemDetails,
  right: number,
  y: RowY,
): void {
  const { countries, countryName, hiddenOwners } = ctx;
  const owner = emblemOwner(d, hiddenOwners.has(s.id) ? null : s.owner, countries);
  if (owner === null) return;
  const key = empireFlagKey(countries.get(owner));
  const texture = key ? tex.texture(key) : null;
  if (!texture) return;
  const capital = d.planets.some((p) => p.capital && p.owner === owner);
  const lines = planetLines(
    ctx,
    tex,
    d.planets.filter((p) => p.colonised && !p.pre_ftl),
  );
  // The flag is drawn oversized (EMBLEM_PX) but centred on the same cell as a row icon
  // (ICON_PX wide, at `right`), so rowLeft/plateBox keep using the cell's own width.
  const cx = right - ICON_PX / 2;
  const cy = y.icon + ICON_PX / 2;
  row.sprite(texture, cx - EMBLEM_PX / 2, cy - EMBLEM_PX / 2, EMBLEM_PX, {
    title: countryName(owner),
    lines,
  });
  if (capital) capitalRim(row.marks, cx, cy);
}

/**
 * A gold hexagon just outside the flag's frame (the composed 70 px flag is a hexagon with
 * its points at the top and bottom, its flats 5 px in from the sides and 20 px down).
 */
function capitalRim(marks: Graphics, cx: number, cy: number): void {
  const k = EMBLEM_PX / 70;
  const grow = CAPITAL_RIM_PX;
  const halfW = 29.5 * k + grow;
  const halfH = 34 * k + grow;
  const flat = 14.5 * k + grow / 2;
  marks
    .poly([
      cx,
      cy - halfH,
      cx + halfW,
      cy - flat,
      cx + halfW,
      cy + flat,
      cx,
      cy + halfH,
      cx - halfW,
      cy + flat,
      cx - halfW,
      cy - flat,
    ])
    .stroke({ color: CAPITAL_RIM_COLOR, width: CAPITAL_RIM_WIDTH, join: "round" });
}
