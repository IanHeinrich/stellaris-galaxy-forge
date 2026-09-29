/** The icons right of a name: a system's on the galaxy map, one body's in the system view. */
import type { ArchaeologySite } from "../../generated/ArchaeologySite";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { Names } from "../names";
import { type Icon, PRE_FTL_ICON } from "./icons";
import {
  anomalyIcon,
  anomalyName,
  megastructureIcon,
  shownMegastructures,
  siteIcon,
} from "./labels";

/** What the icons right of a name stand for. */
export interface NameIconSubject {
  /** The bodies they speak for, whose pre-FTL worlds get an icon and which the tooltips name. */
  readonly planets: readonly PlanetSummary[];
  readonly megastructures: readonly MegastructureSummary[];
  readonly bypasses: readonly Icon[];
  readonly sites: readonly ArchaeologySite[];
  /** The name of the anomaly a body holds; the galaxy's row shows none. */
  readonly anomaly: string | null;
}

export type NameIconKind = "megastructures" | "bypass" | "sites" | "anomaly" | "preFtl";

/** One icon right of a name, standing for every item of its kind. */
export interface NameIconSlot {
  readonly kind: NameIconKind;
  readonly icon: Icon;
  readonly count: number;
}

const NONE: readonly never[] = Object.freeze([]);

/** The pre-FTL worlds among the subject's bodies. */
export function preFtlWorlds(s: NameIconSubject): PlanetSummary[] {
  return s.planets.filter((p) => p.pre_ftl);
}

/**
 * The icons right of a name, in order: the megastructures as one, each bypass, the dig sites
 * as one, the anomaly and the pre-FTL civilisation.
 */
export function nameIconSlots(s: NameIconSubject): NameIconSlot[] {
  const slots: NameIconSlot[] = [];
  const structures = shownMegastructures(s.megastructures);
  const megastructures = megastructureIcon(structures);
  if (megastructures) {
    slots.push({ kind: "megastructures", icon: megastructures, count: structures.length });
  }
  for (const icon of s.bypasses) slots.push({ kind: "bypass", icon, count: 1 });
  const sites = siteIcon(s.sites.map((site) => site.kind));
  if (sites) slots.push({ kind: "sites", icon: sites, count: s.sites.length });
  if (s.anomaly !== null) slots.push({ kind: "anomaly", icon: anomalyIcon(s.anomaly), count: 1 });
  if (preFtlWorlds(s).length > 0) slots.push({ kind: "preFtl", icon: PRE_FTL_ICON, count: 1 });
  return slots;
}

/** Whether both draw the same icons, each with the same title and count. */
export function sameSlots(a: readonly NameIconSlot[], b: readonly NameIconSlot[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) => x.kind === b[i].kind && x.count === b[i].count && x.icon.label === b[i].icon.label,
    )
  );
}

/** A system's icons, from its details and the bypasses touching it. */
export function systemIcons(d: SystemDetails, bypasses: readonly Icon[] = NONE): NameIconSubject {
  return {
    planets: d.planets,
    megastructures: d.megastructures,
    bypasses,
    sites: d.sites,
    anomaly: null,
  };
}

/** One body's icons: the megastructures orbiting it and the dig sites on it, and its anomaly. */
export function bodyIcons(
  p: PlanetSummary,
  d: Pick<SystemDetails, "megastructures" | "sites">,
  names: Names,
): NameIconSubject {
  return {
    planets: [p],
    megastructures: d.megastructures.filter((m) => m.planet === p.id),
    bypasses: NONE,
    sites: d.sites.filter((site) => site.planet === p.id),
    anomaly: p.anomaly ? anomalyName(p.anomaly, names) : null,
  };
}
