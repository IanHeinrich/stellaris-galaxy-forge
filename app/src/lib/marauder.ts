/**
 * The marauder clans a map places by initializer: a clan is one system carrying the game's
 * `marauder_N_1` initializer, whose `init_effect` creates the clan at game start; its two raid
 * bases carry `marauder_N_2` and `_3`, and under Paint a Galaxy the mod adds them beside a home
 * that has none on day one. The role each system has is read by the core into `SystemNode.marauder`
 * (`crates/sgf-core/src/format/scenario/marauder.rs`); this file only reasons over it.
 */

import type { MarauderRole } from "../generated/MarauderRole";
import type { SystemNode } from "../generated/SystemNode";

/** How many clans the game's initializers name. */
export const CLANS = 3;

/** Every clan the game knows, in order. */
export const CLAN_NUMBERS: readonly number[] = Array.from({ length: CLANS }, (_, i) => i + 1);

/** The initializer that makes a system clan `clan`'s home. */
export function homeInitializer(clan: number): string {
  return `marauder_${clan}_1`;
}

/** The clan a role belongs to, whichever end of it the system is. */
export function clanOf(role: MarauderRole): number {
  return "home" in role ? role.home : role.base;
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

/** Why no clan can be added: what the empty-space menu says over its disabled item. */
export const ALL_CLANS_PLACED = "All three clans are placed";
