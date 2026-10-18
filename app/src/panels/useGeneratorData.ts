import { useEffect, useMemo } from "react";
import { multiStarNameKeys, namedStarPicks } from "../lib/details/starClass";
import { useGameDataStore } from "../store/gameDataStore";
import { starClassPicks, useGeneratorStore } from "../store/generatorStore";
import { useNamed } from "./useNamed";

/**
 * The generator's star classes, each multiple star named by its bodies, and the add-system picks,
 * asked for once game data is loaded. `fresh` reads the picks again on every mount, since each add
 * changes what the galaxy holds.
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
  const views = useGameDataStore((s) => s.starClasses);
  const plain = useMemo(() => starClassPicks(picks, starClasses), [picks, starClasses]);
  const named = useNamed(
    multiStarNameKeys(
      plain.map((c) => c.key),
      views,
    ),
  );
  const stars = namedStarPicks(plain, views, named);
  return { gameData, picks, stars };
}
