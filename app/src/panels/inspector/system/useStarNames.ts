import { useEffect } from "react";
import type { SystemNode } from "../../../generated/SystemNode";
import { useGameDataStore } from "../../../store/gameDataStore";

/** Names the keys as they are shown, asking for any not yet fetched. */
export function useNamed(keys: readonly string[]): (key: string) => string {
  const names = useGameDataStore((s) => s.names);
  const list = keys.join("|");
  useEffect(() => {
    if (list !== "") void useGameDataStore.getState().fetchNames(list.split("|"));
  }, [list]);
  return (key) => names.get(key) ?? key;
}

/**
 * A save system's star class as plain text. Every binary is called "Binary Stars", so a multiple
 * star is named by its class's bodies.
 */
export function useStarClassLabel(system: SystemNode, fallback: string): string {
  const own = useGameDataStore((s) => s.starClasses.get(system.star_class));
  const bodyKeys = own && own.planet_keys.length > 1 ? own.planet_keys : [];
  const named = useNamed(bodyKeys);
  return bodyKeys.length > 0 ? bodyKeys.map(named).join(" + ") : fallback;
}
