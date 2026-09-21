/**
 * The marauder clans a map places by initializer. A complete clan is three systems: a home
 * carrying `marauder_N_1`, whose `init_effect` creates the clan at game start, and two raid
 * bases carrying `marauder_N_2` and `marauder_N_3`, each hyperlaned to the home. The role each
 * system has is read by the core into `SystemNode.marauder`
 * (`crates/sgf-core/src/format/scenario/marauder.rs`); this file only reasons over it.
 */

import type { MarauderRole } from "../generated/MarauderRole";
import type { SystemNode } from "../generated/SystemNode";

/** How many clans the game's initializers name. */
export const CLANS = 3;

/** Every clan the game knows, in order. */
export const CLAN_NUMBERS: readonly number[] = Array.from({ length: CLANS }, (_, i) => i + 1);

/** A raid base's site in its initializer: `_2` or `_3`. */
export type BaseSite = 2 | 3;

export const BASE_SITES: readonly BaseSite[] = [2, 3];

/** How far from the home each raid base is placed, by site, in world units. */
export const BASE_DISTANCES: Readonly<Record<BaseSite, number>> = { 2: 20, 3: 25 };

/** How much space a new base keeps from every other system. */
export const BASE_CLEARANCE = 8;

/** Why no clan can be added: what the empty-space menu says over its disabled item. */
export const ALL_CLANS_PLACED = "All three clans are placed";

/** Why three selected systems cannot be made a clan. */
export const BASES_NEED_LANES = "Both raid bases need a hyperlane to the home";

/** Why three selected systems have no home among them: none is linked to the other two. */
export const HOME_NEEDS_LANES = "The home needs a hyperlane to both bases";

/** What making a clan of three systems does to them. */
export const MAKE_CLAN_HINT = "Replaces the three initializers, star class included";

/** What removing a clan does to its systems. */
export const REMOVE_CLAN_HINT = "The three systems become random. Undo puts back what they were";

/** Why a clan cannot take a number: another home already carries it. */
export function clanInUse(clan: number): string {
  return `Clan ${clan} is in use`;
}

export interface Pt {
  x: number;
  y: number;
}

/** The initializer that makes a system clan `clan`'s home. */
export function homeInitializer(clan: number): string {
  return `marauder_${clan}_1`;
}

/** The initializer that makes a system clan `clan`'s raid base at `site`. */
export function baseInitializer(clan: number, site: BaseSite): string {
  return `marauder_${clan}_${site}`;
}

/** The clan a role belongs to, whichever end of it the system is. */
export function clanOf(role: MarauderRole): number {
  return "home" in role ? role.home : role.base;
}

export function isHome(s: SystemNode): boolean {
  return s.marauder !== null && "home" in s.marauder;
}

/** Which of the two sites a base's initializer names; `_3` for anything but `_2`. */
export function baseSite(base: SystemNode): BaseSite {
  return base.initializer.endsWith("_2") ? 2 : 3;
}

/** Clan → the systems carrying its home, ascending; a clan with none is absent. */
export function clanHomes(systems: ReadonlyMap<number, SystemNode>): Map<number, number[]> {
  const homes = new Map<number, number[]>();
  for (const s of systems.values()) {
    if (s.marauder !== null && "home" in s.marauder) {
      const ids = homes.get(s.marauder.home) ?? [];
      ids.push(s.id);
      homes.set(s.marauder.home, ids);
    }
  }
  for (const ids of homes.values()) ids.sort((a, b) => a - b);
  return homes;
}

/** The lowest clan with no home on the map, null once all three are placed. */
export function nextFreeClan(systems: ReadonlyMap<number, SystemNode>): number | null {
  const placed = clanHomes(systems);
  return CLAN_NUMBERS.find((clan) => !placed.has(clan)) ?? null;
}

/** The hyperlane neighbours of `home` that are raid bases of its own clan, in lane order. */
export function basesBeside(
  home: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): SystemNode[] {
  if (home.marauder === null || !("home" in home.marauder)) return [];
  const clan = home.marauder.home;
  const bases: SystemNode[] = [];
  for (const lane of home.lanes) {
    const other = systems.get(lane.to);
    if (!other?.marauder || !("base" in other.marauder) || other.marauder.base !== clan) continue;
    if (!bases.includes(other)) bases.push(other);
  }
  return bases;
}

/** The hyperlane neighbour of `base` that is its own clan's home, or null when none is. */
export function homeBeside(
  base: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): SystemNode | null {
  if (base.marauder === null || !("base" in base.marauder)) return null;
  const clan = base.marauder.base;
  for (const lane of base.lanes) {
    const other = systems.get(lane.to);
    if (other?.marauder && "home" in other.marauder && other.marauder.home === clan) return other;
  }
  return null;
}

/** The base sites `home` has no base beside it for; none once two bases are linked. */
export function missingBaseSites(
  home: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): BaseSite[] {
  const bases = basesBeside(home, systems);
  if (bases.length >= BASE_SITES.length) return [];
  const present = new Set(bases.map(baseSite));
  return BASE_SITES.filter((site) => !present.has(site));
}

/** Every system of clan `clan`: its homes, the bases beside them, and any base left on its own. */
export function clanSystems(clan: number, systems: ReadonlyMap<number, SystemNode>): number[] {
  const ids: number[] = [];
  for (const s of systems.values()) {
    if (s.marauder !== null && clanOf(s.marauder) === clan) ids.push(s.id);
  }
  return ids.sort((a, b) => a - b);
}

/** Bearings are tried from north, a step at a time, until a site is clear of every system. */
const FIRST_BEARING = -Math.PI / 2;
const BEARING_STEP = Math.PI / 12;
const BEARINGS = 24;
/** The second base starts a third of a turn round from the first, so the two never meet. */
const SITE_SPREAD = (2 * Math.PI) / 3;

/**
 * Where new raid bases go about `home`: each at its site's distance, on the first bearing
 * whose point keeps `BASE_CLEARANCE` from every system and from the bases placed before it.
 * The last bearing tried is taken when none is clear.
 */
export function placeBases(
  home: Pt,
  sites: readonly BaseSite[],
  systems: Iterable<SystemNode>,
): Array<{ site: BaseSite; x: number; y: number }> {
  const taken: Pt[] = [...systems];
  const placed: Array<{ site: BaseSite; x: number; y: number }> = [];
  sites.forEach((site, i) => {
    const distance = BASE_DISTANCES[site];
    let point = { x: home.x, y: home.y - distance };
    for (let step = 0; step < BEARINGS; step++) {
      const bearing = FIRST_BEARING + i * SITE_SPREAD + step * BEARING_STEP;
      point = {
        x: home.x + Math.cos(bearing) * distance,
        y: home.y + Math.sin(bearing) * distance,
      };
      if (taken.every((s) => Math.hypot(s.x - point.x, s.y - point.y) >= BASE_CLEARANCE)) break;
    }
    taken.push(point);
    placed.push({ site, ...point });
  });
  return placed;
}

/**
 * The one of `ids` with a hyperlane to each of the others: the home of the clan they would make.
 * The lowest id when more than one qualifies, null when none does.
 */
export function middleOf(
  ids: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
): number | null {
  const middles = ids.filter((id) => {
    const lanes = systems.get(id)?.lanes ?? [];
    return ids.every((other) => other === id || lanes.some((lane) => lane.to === other));
  });
  return middles.length === 0 ? null : Math.min(...middles);
}

export interface ClanMenuItem {
  label: string;
  /** What the item does when enabled, or why it is disabled. */
  hint: string;
  /** The home and its two bases, null while the item is disabled. */
  clan: { home: number; bases: [number, number] } | null;
}

/** What `selection` makes of "Add marauder clan": the clan to make, or why not, with the label and hint. */
export function clanMenuItem(
  selection: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
  freeClan: number | null,
): ClanMenuItem {
  const disabled = (hint: string, label = "Add marauder clan") => ({ label, hint, clan: null });
  if (selection.length <= 1) return disabled("Select two more systems to make a clan");
  if (selection.length === 2) return disabled("Select one more system");
  if (selection.length > 3) return disabled("Select exactly three systems");
  if (freeClan === null) return disabled(ALL_CLANS_PLACED);
  const label = `Make these marauder clan ${freeClan}`;
  const home = middleOf(selection, systems);
  if (home === null) return disabled(HOME_NEEDS_LANES, label);
  const [second, third] = selection.filter((id) => id !== home);
  return { label, hint: MAKE_CLAN_HINT, clan: { home, bases: [second, third] } };
}
