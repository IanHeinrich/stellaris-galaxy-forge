import type { MegastructureSummary } from "../../../generated/MegastructureSummary";
import { megastructureLabel, shownMegastructures, siteLabel } from "../../../lib/details/labels";
import {
  type NameIconKind,
  type NameIconSlot,
  type NameIconSubject,
  nameIconSlots,
  preFtlWorlds,
} from "../../../lib/details/nameIcons";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import type { RowY, Textures } from "./cell";
import { collapsed } from "./icons";
import { type PlanetLineContext, planetLines } from "./planets";
import type { Row } from "./Row";

/** One icon right of a name, with its tooltip's lines. */
export interface NameIcon extends NameIconSlot {
  readonly lines: MapTooltipLine[];
}

const ANOMALY_LINES: MapTooltipLine[] = ["Anomaly"];

/** The icons right of a name, as `nameIconSlots` orders them, each with its tooltip's lines. */
export function nameIcons(ctx: PlanetLineContext, tex: Textures, s: NameIconSubject): NameIcon[] {
  return nameIconSlots(s).map((slot) => ({ ...slot, lines: slotLines(ctx, tex, s, slot.kind) }));
}

/** Draws `icons` from cell `x` on; returns the x past the last. */
export function drawNameIcons(
  row: Row,
  tex: Textures,
  icons: readonly NameIcon[],
  x: number,
  y: RowY,
): number {
  for (const { icon, count, lines } of icons) x = collapsed(row, tex, icon, x, count, lines, y);
  return x;
}

function slotLines(
  ctx: PlanetLineContext,
  tex: Textures,
  s: NameIconSubject,
  kind: NameIconKind,
): MapTooltipLine[] {
  switch (kind) {
    case "megastructures":
      return megastructureLines(ctx, shownMegastructures(s.megastructures));
    case "bypass":
      return [];
    case "sites":
      return siteLines(ctx, s);
    case "anomaly":
      return ANOMALY_LINES;
    case "preFtl":
      return planetLines(ctx, tex, preFtlWorlds(s));
  }
}

function megastructureLines(
  ctx: PlanetLineContext,
  structures: readonly MegastructureSummary[],
): MapTooltipLine[] {
  if (structures.length < 2) return [];
  return structures.map((m) => ({
    label: megastructureLabel(m.kind),
    value: m.owner === null ? "unowned" : ctx.countryName(m.owner),
  }));
}

function siteLines(ctx: PlanetLineContext, s: NameIconSubject): MapTooltipLine[] {
  return s.sites.map((site) => {
    const planet = s.planets.find((p) => p.id === site.planet);
    const value = planet ? ctx.templateName(planet) : "";
    return s.sites.length > 1 ? { label: siteLabel(site.kind), value } : value;
  });
}
