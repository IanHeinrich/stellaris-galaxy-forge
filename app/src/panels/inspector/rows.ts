import type { BypassLink } from "../../generated/BypassLink";
import type { DepositCount } from "../../generated/DepositCount";
import type { FleetSummary } from "../../generated/FleetSummary";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { ShipSizeView } from "../../generated/ShipSizeView";
import { FALLBACK_HABITABLE } from "../../lib/details/labels";
import { keyWords } from "../../lib/text";

export const POP_ICON_KEY = "sprite:GFX_pop";

/** Deposits beyond this many move to a line of their own under the detail line. */
export const INLINE_RESOURCES = 3;

/** Rows past this many are hidden behind "show N more". */
export const LIST_LIMIT = 8;

/** `5432` → `5.4K`, `12` → `12`: pop counts as the game writes them. */
export function formatPops(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function habitable(p: PlanetSummary): boolean {
  return p.habitable ?? FALLBACK_HABITABLE.test(p.class);
}

function planetRank(p: PlanetSummary, isStar: (p: PlanetSummary) => boolean): number {
  if (isStar(p)) return 0;
  if (p.capital) return 1;
  if (p.colonised) return 2;
  return habitable(p) ? 3 : 4;
}

/**
 * The star first, then the capital, the colonies, the free habitable worlds and the rest. A moon
 * has no parent field in the save, so it belongs to the planet it follows in file order and
 * travels with it.
 */
export function orderedPlanets(
  planets: readonly PlanetSummary[],
  isStar: (p: PlanetSummary) => boolean,
): PlanetSummary[] {
  const groups: PlanetSummary[][] = [];
  for (const p of planets) {
    if (!p.moon || groups.length === 0) groups.push([p]);
    else groups[groups.length - 1].push(p);
  }
  return groups
    .map((planets, index) => ({ planets, index, rank: planetRank(planets[0], isStar) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .flatMap((g) => g.planets);
}

export interface PlanetTotals {
  planets: number;
  colonies: number;
  preFtl: number;
  pops: number;
}

export function planetTotals(planets: readonly PlanetSummary[]): PlanetTotals {
  return {
    planets: planets.length,
    colonies: planets.filter((p) => p.colonised && !p.pre_ftl).length,
    preFtl: planets.filter((p) => p.pre_ftl).length,
    pops: planets.reduce((total, p) => total + p.pops, 0),
  };
}

/** Whether the save's bypass list has this system's gateway open. */
export function gatewayActive(bypasses: readonly BypassLink[], system: number): boolean {
  return bypasses.some((b) => b.type === "gateway" && b.system === system && b.active);
}

const MILITARY_RANK = /^ship_size_military_(\d+)$/;

/**
 * The badge a fleet wears: the icon of the highest military rank among its ships, else the icon
 * of its first ship size.
 */
export function fleetIcon(
  f: FleetSummary,
  shipSizes: ReadonlyMap<string, ShipSizeView>,
): string | null {
  let best: string | null = null;
  let bestRank = 0;
  let first: string | null = null;
  for (const { key } of f.ship_sizes) {
    const icon = shipSizes.get(key)?.icon;
    if (!icon) continue;
    first ??= icon;
    const rank = MILITARY_RANK.exec(icon);
    if (rank && Number(rank[1]) > bestRank) {
      bestRank = Number(rank[1]);
      best = icon;
    }
  }
  return best ?? first;
}

/** The glyph drawn when the ship-size sprite is unavailable. */
export function fleetGlyph(icon: string | null): string {
  if (icon === null) return "✶";
  if (MILITARY_RANK.test(icon)) return "⋀";
  if (icon.includes("constructor")) return "🔧";
  if (icon.includes("science")) return "⚛";
  if (icon.includes("colon")) return "⌂";
  return "✶";
}

const SHIP_ROLES: Record<string, string> = {
  constructor: "Construction ship",
  science: "Science ship",
  colonizer: "Colony ship",
  transport: "Transport ship",
};

/** The save's own deposit keys with their counts, as the resource pills' title lists them. */
export function depositTitle(deposits: readonly DepositCount[]): string | undefined {
  if (deposits.length === 0) return undefined;
  return deposits.map((d) => (d.count > 1 ? `${d.key} ×${d.count}` : d.key)).join(" · ");
}

/** What a utility fleet is: its first ship size, localised when the game data knows the key. */
export function shipRole(f: FleetSummary, names: ReadonlyMap<string, string>): string {
  const key = f.ship_sizes[0]?.key;
  if (!key) return "No ships";
  return names.get(key) ?? SHIP_ROLES[key] ?? keyWords(key);
}

export function shipSizeChips(f: FleetSummary, names: ReadonlyMap<string, string>): string {
  return f.ship_sizes
    .map(({ key, count }) => `${count} × ${names.get(key) ?? keyWords(key)}`)
    .join(" · ");
}
