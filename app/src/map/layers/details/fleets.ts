import type { SystemDetails } from "../../../generated/SystemDetails";
import {
  type FleetGroup,
  fleetGroups,
  fleetLabel,
  fleetPower,
  fleetSides,
  formatPower,
} from "../../../lib/details/fleets";
import {
  FAUNA_FLEET_ICON_KEY,
  FLEET_ICON_KEY,
  HOSTILE_FLEET_ICON_KEY,
} from "../../../lib/details/icons";
import { PLANET_STACK } from "../../../lib/details/layout";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import type { RenderContext } from "../../RenderContext";
import { GLYPH_STYLE, PLANET_DX, PLANET_PX, PLANET_Y, type Textures } from "./cell";
import type { Row } from "./Row";

/** Fleet icons mirror the planet stack, immediately right of the star instead of left. */
const FLEET_LEFT = PLANET_STACK.gap;

/**
 * Fleets mirror the planet stack: the same size, on the star's level, immediately right of it,
 * empire first then fauna, stacked rightwards with the nearer (empire) one drawn last, on top.
 */
export function fleets(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  d: SystemDetails,
  withIcons: boolean,
): void {
  const { countryName, countries } = ctx;
  const groups = fleetGroups(d, countryName);
  if (groups.length === 0) return;
  if (!withIcons) {
    const count = groups.reduce((n, g) => n + g.fleets.length, 0);
    const tip = { title: fleetLabel(count), lines: fleetLines(ctx, groups) };
    row.text(tip.title, FLEET_LEFT, PLANET_Y + 4, tip);
    return;
  }
  const { empire, fauna } = fleetSides(groups, countries, ctx.countryTypes);
  const slots: Array<{ groups: FleetGroup[]; key: string }> = [];
  if (empire.length > 0) slots.push({ groups: empire, key: FLEET_ICON_KEY });
  if (fauna.length > 0) {
    const hostile = fauna.some((g) => g.owner === null);
    slots.push({
      groups: fauna,
      key: hostile ? HOSTILE_FLEET_ICON_KEY : FAUNA_FLEET_ICON_KEY,
    });
  }
  for (let i = slots.length - 1; i >= 0; i--) {
    fleetIcon(row, ctx, tex, slots[i].groups, slots[i].key, FLEET_LEFT + i * PLANET_DX);
  }
}

function fleetIcon(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  groups: FleetGroup[],
  key: string,
  x: number,
): void {
  const count = groups.reduce((n, g) => n + g.fleets.length, 0);
  const tip = { title: fleetLabel(count), lines: fleetLines(ctx, groups) };
  const texture = tex.texture(key);
  if (texture) row.sprite(texture, x, PLANET_Y, PLANET_PX, tip);
  else if (texture === null) row.text("⚔", x + 3, PLANET_Y + 2, tip, GLYPH_STYLE);
}

function fleetLines(ctx: RenderContext, groups: FleetGroup[]): MapTooltipLine[] {
  const lines: MapTooltipLine[] = [];
  for (const g of groups) {
    lines.push({
      heading: `${g.name} · ${fleetLabel(g.fleets.length)}`,
      value: formatPower(g.power),
    });
    for (const f of g.fleets) {
      lines.push({ label: ctx.templateName(f), value: fleetPower(f), indent: true });
    }
  }
  return lines;
}
