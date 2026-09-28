import { bodyName } from "../lib/details/labels";
import { findPlanet } from "../lib/details/starBody";
import type { MovedPlanet, WarningNames } from "../lib/planetMove";
import { useDetailsStore } from "../store/detailsStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useGameDataStore } from "../store/gameDataStore";
import { usePlanetMoveStore } from "../store/planetMoveStore";

const NONE: readonly number[] = [];

/** Any read body's name, as its planet page names it; `#id` for one no read system lists. */
export function usePlanetName(): (id: number) => string {
  const details = useDetailsStore((s) => s.details);
  const names = useGameDataStore((s) => s.names);
  return (id) => {
    const found = findPlanet(details, id);
    return found === null ? `#${id}` : bodyName(found.planet, names);
  };
}

/** The names a move's warnings read out. */
export function useWarningNames(): WarningNames {
  const planet = usePlanetName();
  const country = useGalaxyStore((s) => s.countryName);
  return { planet, country };
}

/** Planets `ids` as the copy names them: a moon among them arrives as a planet. */
export function useMovedPlanets(ids: readonly number[]): MovedPlanet[] {
  const details = useDetailsStore((s) => s.details);
  const names = useGameDataStore((s) => s.names);
  return ids.map((id) => {
    const found = findPlanet(details, id);
    return {
      name: found === null ? `#${id}` : bodyName(found.planet, names),
      moon: found?.planet.moon === true,
    };
  });
}

/** The planets waiting for a paste and the system they stand in; null with no cut. */
export function useCut(): { planets: MovedPlanet[]; from: string; count: number } | null {
  const cut = usePlanetMoveStore((s) => s.cut);
  const planets = useMovedPlanets(cut?.planets ?? NONE);
  const from = useGalaxyStore((s) => (cut === null ? "" : s.systemName(cut.from)));
  return cut === null ? null : { planets, from, count: cut.planets.length };
}
