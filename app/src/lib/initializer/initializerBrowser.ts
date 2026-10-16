import type { DepositView } from "../../generated/DepositView";
import type { InitPlanetView } from "../../generated/InitPlanetView";
import type { InitializerView } from "../../generated/InitializerView";
import type { SystemNode } from "../../generated/SystemNode";
import { pickedGroups } from "../browsePicks";
import { groupInitializers, type ModRef } from "./initializerGroups";
import { compareResources } from "../resources";

/** The choice that leaves the system to the game, which is no initializer at all. */
export const RANDOM_KEY = "@random";

export interface BrowserEntry {
  entry: InitializerView;
  /** Systems in the open document that already use this initializer. */
  uses: number;
}

export interface BrowserGroup {
  id: string;
  label: string;
  entries: BrowserEntry[];
}

function uses(entry: InitializerView, counts: ReadonlyMap<string, number>): BrowserEntry {
  return { entry, uses: counts.get(entry.name) ?? 0 };
}

/**
 * What the initializer browser lists: your pinned and recent picks first, then every group the
 * game data defines, each entry carrying how many systems already use it.
 */
export function browserGroups(
  list: InitializerView[],
  mods: ModRef[],
  pinned: readonly string[],
  recent: readonly string[],
  counts: ReadonlyMap<string, number>,
): BrowserGroup[] {
  return [
    ...pickedGroups(list, (entry) => entry.name, pinned, recent),
    ...groupInitializers(list, mods),
  ].map((group) => ({
    id: group.id,
    label: group.label,
    entries: group.entries.map((entry) => uses(entry, counts)),
  }));
}

function addDeposits(
  totals: Map<string, number>,
  body: InitPlanetView,
  deposits: ReadonlyMap<string, DepositView>,
): void {
  for (const key of body.deposits) {
    for (const [resource, amount] of deposits.get(key)?.produces ?? []) {
      totals.set(resource, (totals.get(resource) ?? 0) + amount);
    }
  }
  for (const moon of body.moons) addDeposits(totals, moon, deposits);
}

/**
 * What the whole system the initializer spawns produces: every body's and moon's deposits summed
 * per resource, in the game's display order.
 */
export function initializerTotals(
  entry: InitializerView,
  deposits: ReadonlyMap<string, DepositView>,
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const body of entry.planets) addDeposits(totals, body, deposits);
  return [...totals].sort((a, b) => compareResources(a[0], b[0]));
}

/** What the menu calls the absent initializer, which leaves the new system to the game. */
export const RANDOM_DETAIL = "random";

export interface NewSystemRow {
  label: string;
  /** The initializer the row spawns the system from, `null` for random. */
  key: string | null;
  /** The key as the row shows it, on the right. */
  detail: string;
}

/**
 * The rows that create a system without asking: this machine's default, and the last initializer
 * used where that is something else.
 */
export function newSystemRows(defaultKey: string | null, lastUsed: string | null): NewSystemRow[] {
  const rows: NewSystemRow[] = [
    { label: "New system", key: defaultKey, detail: defaultKey ?? RANDOM_DETAIL },
  ];
  if (lastUsed !== null && lastUsed !== defaultKey) {
    rows.push({ label: "New system, last used", key: lastUsed, detail: lastUsed });
  }
  return rows;
}

/** The keys the targets already carry, the random key standing in for no initializer at all. */
export function currentKeys(
  targets: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
): Set<string> {
  const keys = new Set<string>();
  for (const id of targets) {
    const system = systems.get(id);
    if (system !== undefined) keys.add(system.initializer === "" ? RANDOM_KEY : system.initializer);
  }
  return keys;
}
