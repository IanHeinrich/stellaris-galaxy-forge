import type { InitializerView } from "../../generated/InitializerView";
import type { SystemNode } from "../../generated/SystemNode";
import { RANDOM_KEY } from "../../store/initializerBrowserStore";

/** What the list calls the random choice, which is no initializer at all. */
export const RANDOM_LABEL = "Random (no initializer)";

/** The keys an entry's own name may be written under: its display name, else the star body's. */
export function nameKeysOf(entry: InitializerView): string[] {
  const keys: string[] = [];
  if (entry.display_name !== null && entry.display_name !== "") keys.push(entry.display_name);
  const star = entry.planets[0]?.name;
  if (star !== null && star !== undefined && star !== "") keys.push(star);
  return keys;
}

/** The entry's localised name, or null where the game data names it nothing the key does not. */
export function entryLabel(
  entry: InitializerView,
  names: ReadonlyMap<string, string>,
): string | null {
  for (const key of nameKeysOf(entry)) {
    const name = names.get(key);
    if (name !== undefined && name !== "") return name;
  }
  return null;
}

/** The file an entry is defined in, short enough to sit in a badge. */
export function sourceBadge(source: string): string {
  return source.replace(/\\/g, "/").split("/").pop() ?? source;
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
