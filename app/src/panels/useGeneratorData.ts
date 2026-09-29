import { useEffect, useMemo } from "react";
import type { BodyClassPick } from "../generated/BodyClassPick";
import { useGameDataStore } from "../store/gameDataStore";
import { starClassPicks, useGeneratorStore } from "../store/generatorStore";

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

/**
 * The generator's star classes and the add-system picks, asked for once game data is loaded.
 * `fresh` reads the picks again on every mount, since each add changes what the galaxy holds.
 */
export function useGeneratorData(fresh = false) {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const starClasses = useGeneratorStore((s) => s.starClasses);
  const picks = useGeneratorStore((s) => s.picks);
  const askPicks = fresh || picks === null;
  useEffect(() => {
    if (!gameData) return;
    const generator = useGeneratorStore.getState();
    generator.request();
    if (askPicks) generator.refreshPicks();
  }, [gameData, askPicks]);
  const stars = useMemo(() => starClassPicks(picks, starClasses), [picks, starClasses]);
  return { gameData, picks, stars };
}
