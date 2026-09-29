import type { Graphics, Texture } from "pixi.js";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import type { SystemNode } from "../../../generated/SystemNode";
import { isColony } from "../../../lib/details/labels";
import { type Box, type NameEmblem, nameEmblem } from "../../../lib/details/layout";
import type { Ownership } from "../../../lib/ownership";
import type { RenderContext } from "../../RenderContext";
import { DISC_PX, ICON_PX, type RowY, type Textures } from "./cell";
import type { Tip } from "./Hover";
import { type PlanetLineContext, planetLines } from "./planets";
import type { Row } from "./Row";

/**
 * The empire flag texture (`compose_empire_flag`) pads a 60 px disc inside a 70 px frame; the
 * sprite is drawn oversized so the disc itself reads at `DISC_PX`, like a row icon's.
 */
const EMBLEM_PX = (DISC_PX * 70) / 60;
const CAPITAL_RIM_PX = 1;
const CAPITAL_RIM_WIDTH = 2;
const CAPITAL_RIM_COLOR = 0xe8c872;

/** What a flag's tooltip reads: the owner's name and the colonies' lines. */
export type FlagContext = PlanetLineContext & Pick<Ownership, "table">;

/** The flag left of a system's name, for whoever holds it. */
export function ownerFlag(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  s: SystemNode,
  d: SystemDetails,
  right: number,
  y: RowY,
): void {
  const { countries, owners, hiddenOwners } = ctx;
  const systemOwner = hiddenOwners.has(s.id) ? null : (owners.get(s.id) ?? null);
  const emblem = nameEmblem(d.planets, countries, systemOwner);
  if (emblem) emblemFlag(row, ctx, tex, emblem, d.planets, right, y);
}

/**
 * `emblem`'s flag in the cell whose right edge is `right`, its tooltip naming the owner and the
 * colonies among `planets`; nothing while the flag has not landed or cannot.
 */
export function emblemFlag(
  row: Row,
  ctx: FlagContext,
  tex: Textures,
  emblem: NameEmblem,
  planets: readonly PlanetSummary[],
  right: number,
  y: RowY,
): void {
  const texture = emblem.flag === null ? null : tex.texture(emblem.flag);
  if (!texture) return;
  const title = ctx.table.get(emblem.owner)?.label ?? ctx.countryName(emblem.owner);
  const lines = planetLines(ctx, tex, planets.filter(isColony));
  flag(row, texture, right, y, emblem.capital, { title, lines });
}

/**
 * An empire flag in the row icon cell whose right edge is `right`, ringed in gold on the owner's
 * capital. The flag is drawn oversized (EMBLEM_PX) but centred on the cell (ICON_PX wide), so
 * plateBox keeps using the cell's own width.
 */
function flag(
  row: Row,
  texture: Texture,
  right: number,
  y: RowY,
  capital: boolean,
  tip: Tip,
): void {
  const cx = right - ICON_PX / 2;
  const cy = y.icon + ICON_PX / 2;
  row.sprite(texture, cx - EMBLEM_PX / 2, cy - EMBLEM_PX / 2, EMBLEM_PX, tip);
  if (capital) capitalRim(row.marks, cx, cy);
}

/** Everything `flag` draws for the cell whose right edge is `right`, its capital's rim included. */
export function flagBox(right: number, y: RowY): Box {
  const reach = EMBLEM_PX / 2 + CAPITAL_RIM_PX + CAPITAL_RIM_WIDTH / 2;
  const cx = right - ICON_PX / 2;
  const cy = y.icon + ICON_PX / 2;
  return { x: cx - reach, y: cy - reach, width: 2 * reach, height: 2 * reach };
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
