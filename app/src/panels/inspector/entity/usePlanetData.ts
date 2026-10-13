import { useEffect } from "react";
import { usePlanetDataStore, type PlanetDataKeys } from "../../../store/planetDataStore";

/** Asks for the game data `keys` names, and again as the install's game data reloads. */
export function usePlanetData(keys: PlanetDataKeys): void {
  const generation = usePlanetDataStore((s) => s.generation);
  useEffect(() => {
    usePlanetDataStore.getState().request(keys);
  }, [keys, generation]);
}
