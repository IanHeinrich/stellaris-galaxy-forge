import type { DepositView } from "../../generated/DepositView";
import type { InitPlanetView } from "../../generated/InitPlanetView";
import type { InitializerView } from "../../generated/InitializerView";
import { groupInitializers, type ModRef } from "./initializerGroups";
import { compareResources } from "../resources";

/** How many picks the recent list keeps. */
export const RECENT_CAP = 10;

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

export const PINNED_GROUP = { id: "pinned", label: "Pinned" };
export const RECENT_GROUP = { id: "recent", label: "Recent" };

function uses(entry: InitializerView, counts: ReadonlyMap<string, number>): BrowserEntry {
  return { entry, uses: counts.get(entry.name) ?? 0 };
}

/** The named initializers in the order named, less the ones the loaded game data does not have. */
function namedGroup(
  id: string,
  label: string,
  keys: readonly string[],
  byName: ReadonlyMap<string, InitializerView>,
  counts: ReadonlyMap<string, number>,
): BrowserGroup | null {
  const entries: BrowserEntry[] = [];
  for (const key of keys) {
    const entry = byName.get(key);
    if (entry !== undefined) entries.push(uses(entry, counts));
  }
  return entries.length === 0 ? null : { id, label, entries };
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
  const byName = new Map(list.map((entry) => [entry.name, entry]));
  const groups: BrowserGroup[] = [];
  const pins = namedGroup(PINNED_GROUP.id, PINNED_GROUP.label, pinned, byName, counts);
  if (pins !== null) groups.push(pins);
  const recents = namedGroup(RECENT_GROUP.id, RECENT_GROUP.label, recent, byName, counts);
  if (recents !== null) groups.push(recents);
  for (const group of groupInitializers(list, mods)) {
    groups.push({
      id: group.id,
      label: group.label,
      entries: group.entries.map((entry) => uses(entry, counts)),
    });
  }
  return groups;
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

/** Pin the initializer, or unpin it when it is already pinned; a new pin goes last. */
export function pinToggle(pinned: readonly string[], key: string): string[] {
  return pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
}

/** The recent list after picking `key`: most recent first, no repeats, `cap` at most. */
export function notedRecent(recent: readonly string[], key: string, cap = RECENT_CAP): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, Math.max(cap, 0));
}
