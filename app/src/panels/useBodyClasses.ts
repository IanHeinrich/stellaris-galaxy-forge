import { useEffect } from "react";
import type { BodyClassPick } from "../generated/BodyClassPick";
import { useGameDataStore } from "../store/gameDataStore";
import { useGeneratorStore } from "../store/generatorStore";

/**
 * The classes an added moon, or with `moon` false an added planet, may take, asked for once
 * game data is loaded; null until they are read.
 */
export function useBodyClasses(moon: boolean): BodyClassPick[] | null {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const classes = useGeneratorStore((s) => (moon ? s.moonClasses : s.planetClasses));
  useEffect(() => {
    if (gameData) useGeneratorStore.getState().requestBodyClasses();
  }, [gameData]);
  return classes;
}
