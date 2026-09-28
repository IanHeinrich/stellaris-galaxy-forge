import type { FlagRef } from "../generated/FlagRef";
import type { SaveMeta } from "../generated/SaveMeta";

/**
 * The texture key `compose_empire_flag` draws: background, icon and the first four colours. A null
 * icon draws the background alone.
 */
export function flagKey(
  background: FlagRef,
  icon: FlagRef | null,
  colors: readonly string[],
): string {
  const four = [0, 1, 2, 3].map((i) => colors[i] ?? "null");
  const emblem = icon === null ? "" : `${icon.category}/${icon.file}`;
  return `empire_flag:${background.file}:${emblem}:${four.join(",")}`;
}

/** The flag of the empire a save's header names, or null when the header gives no full flag. */
export function saveFlagKey(meta: SaveMeta | null): string | null {
  const flag = meta?.flag;
  if (!flag?.icon || !flag.background) return null;
  return flagKey(flag.background, flag.icon, flag.colors);
}
