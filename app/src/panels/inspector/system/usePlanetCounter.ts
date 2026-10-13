import type { SystemDetails } from "../../../generated/SystemDetails";
import { isAsteroidClass, planetCounts, type PlanetCounts } from "../../../lib/details/spawnFacts";
import { isStar } from "../../../lib/details/starBody";
import { useGameDataStore } from "../../../store/gameDataStore";

/** Counts the planets, moons and asteroids of a system's details, as the loaded classes tell them apart. */
export function usePlanetCounter(): (
  details: Pick<SystemDetails, "planets" | "spawn">,
) => PlanetCounts {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  return (details) =>
    planetCounts(
      details,
      (p) => isStar(p, { planetClasses, starClasses }),
      (p) => isAsteroidClass(p.class, planetClasses),
    );
}
