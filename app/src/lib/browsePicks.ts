/** How many picks a browser's recent list keeps. */
export const RECENT_CAP = 10;

export const PINNED_GROUP = { id: "pinned", label: "Pinned" };
export const RECENT_GROUP = { id: "recent", label: "Recent" };

/** One of the groups a browser lists ahead of its own: the pinned or the recent picks. */
export interface PickedGroup<T> {
  id: string;
  label: string;
  entries: T[];
}

/**
 * The pinned and then the recent picks out of `list`, each in the order its keys were given, less
 * the keys `list` does not have; a group with nothing left is left out.
 */
export function pickedGroups<T>(
  list: readonly T[],
  keyOf: (entry: T) => string,
  pinned: readonly string[],
  recent: readonly string[],
): PickedGroup<T>[] {
  const byKey = new Map(list.map((entry) => [keyOf(entry), entry]));
  const groups: PickedGroup<T>[] = [];
  for (const [group, keys] of [
    [PINNED_GROUP, pinned],
    [RECENT_GROUP, recent],
  ] as const) {
    const entries = keys.flatMap((key) => byKey.get(key) ?? []);
    if (entries.length > 0) groups.push({ ...group, entries });
  }
  return groups;
}

/** Pin the key, or unpin it when it is already pinned; a new pin goes last. */
export function pinToggle(pinned: readonly string[], key: string): string[] {
  return pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
}

/** The recent list after picking `key`: most recent first, no repeats, `cap` at most. */
export function notedRecent(recent: readonly string[], key: string, cap = RECENT_CAP): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, Math.max(cap, 0));
}
