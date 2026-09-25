import { useEffect } from "react";
import { useGameDataStore } from "../store/gameDataStore";

const asKey = (key: string) => key;

/**
 * Names the keys as they are shown, asking for any not yet fetched, and again when game data is
 * reloaded. A key with no name reads as `fallback` makes it, the key itself by default.
 */
export function useNamed(
  keys: readonly string[],
  fallback: (key: string) => string = asKey,
): (key: string) => string {
  const names = useGameDataStore((s) => s.names);
  const loaded = useGameDataStore((s) => `${s.status}/${s.version}`);
  const list = keys.filter(Boolean).join("|");
  useEffect(() => {
    if (list !== "") void useGameDataStore.getState().fetchNames(list.split("|"));
  }, [list, loaded]);
  return (key) => names.get(key) || fallback(key);
}
