import { useEffect, useMemo } from "react";
import { buildsStars, documentCapabilities } from "../lib/capabilities";
import { useFileSessionStore } from "../store/fileSessionStore";
import { useGameDataStore } from "../store/gameDataStore";
import { starClassPicks, useGeneratorStore } from "../store/generatorStore";
import { useStarClassLabel } from "./useStarClassLabel";

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
  const plain = useMemo(() => starClassPicks(picks, starClasses), [picks, starClasses]);
  const label = useStarClassLabel(plain.map((c) => c.key));
  const stars = plain.map((c) => ({ ...c, label: label(c.key, c.label) }));
  return { gameData, picks, stars };
}

/**
 * The arrangements a binary or trinary is built in and the star types a slot offers, asked for
 * once game data is loaded and the document builds systems from chosen stars.
 */
export function useStarData() {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const builds = useFileSessionStore((s) => buildsStars(documentCapabilities(s)));
  const arrangements = useGeneratorStore((s) => s.arrangements);
  const starTypes = useGeneratorStore((s) => s.starTypes);
  useEffect(() => {
    if (gameData && builds) useGeneratorStore.getState().requestStars();
  }, [gameData, builds]);
  return { arrangements, starTypes };
}
