import type { ArchaeologySite } from "../../../generated/ArchaeologySite";
import type { MegastructureSummary } from "../../../generated/MegastructureSummary";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { type Icon, PRE_FTL_ICON } from "../../../lib/details/icons";
import {
  anomalyIcon,
  megastructureIcon,
  megastructureLabel,
  shownMegastructures,
  siteIcon,
  siteLabel,
} from "../../../lib/details/labels";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import type { RowY, Textures } from "./cell";
import { collapsed } from "./icons";
import { type PlanetLineContext, planetLines } from "./planets";
import type { Row } from "./Row";

/** What the icons right of a name stand for: a system's on the galaxy map, one body's in the system view. */
export interface NameIconSubject {
  /** The bodies they speak for, which the dig site and pre-FTL tooltips name. */
  readonly planets: readonly PlanetSummary[];
  readonly megastructures: readonly MegastructureSummary[];
  readonly bypasses: readonly Icon[];
  readonly sites: readonly ArchaeologySite[];
  /** The name of the anomaly a body holds; the galaxy's row shows none. */
  readonly anomaly: string | null;
}

/** One icon right of a name, standing for every item of its kind, with its tooltip's lines. */
export interface NameIcon {
  readonly icon: Icon;
  readonly count: number;
  readonly lines: MapTooltipLine[];
}

const ANOMALY_LINES: MapTooltipLine[] = ["Anomaly"];

/**
 * The icons right of a name, in order: the megastructures as one, each bypass, the dig sites
 * as one, the anomaly and the pre-FTL civilisation.
 */
export function nameIcons(ctx: PlanetLineContext, tex: Textures, s: NameIconSubject): NameIcon[] {
  const icons: NameIcon[] = [];
  const structures = shownMegastructures(s.megastructures);
  const megastructures = megastructureIcon(structures);
  if (megastructures) {
    const lines = megastructureLines(ctx, structures);
    icons.push({ icon: megastructures, count: structures.length, lines });
  }
  for (const icon of s.bypasses) icons.push({ icon, count: 1, lines: [] });
  const sites = siteIcon(s.sites.map((site) => site.kind));
  if (sites) icons.push({ icon: sites, count: s.sites.length, lines: siteLines(ctx, s) });
  if (s.anomaly !== null) {
    icons.push({ icon: anomalyIcon(s.anomaly), count: 1, lines: ANOMALY_LINES });
  }
  const worlds = s.planets.filter((p) => p.pre_ftl);
  if (worlds.length > 0) {
    icons.push({ icon: PRE_FTL_ICON, count: 1, lines: planetLines(ctx, tex, worlds) });
  }
  return icons;
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
