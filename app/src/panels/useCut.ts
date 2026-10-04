import type { MovedPlanet, WarningNames } from "../lib/planetMove";
import { useGalaxyStore } from "../store/galaxyStore";
import { usePlanetMoveStore } from "../store/planetMoveStore";
import { useBodyLookup } from "./inspector/entity/useBodyName";

const NONE: readonly number[] = [];

/** The names a move's warnings read out. */
export function useWarningNames(): WarningNames {
  const lookup = useBodyLookup();
  const country = useGalaxyStore((s) => s.countryName);
  return { planet: (id) => lookup(id).name, country };
}

/** Planets `ids` as the copy names them: a moon among them arrives as a planet. */
export function useMovedPlanets(ids: readonly number[]): MovedPlanet[] {
  const lookup = useBodyLookup();
  return ids.map((id) => lookup(id));
}

/** The planets waiting for a paste and the system they stand in; null with no cut. */
export function useCut(): {
  planets: MovedPlanet[];
  from: string;
  fromId: number;
  count: number;
} | null {
  const cut = usePlanetMoveStore((s) => s.cut);
  const planets = useMovedPlanets(cut?.planets ?? NONE);
  const from = useGalaxyStore((s) => (cut === null ? "" : s.systemName(cut.from)));
  return cut === null ? null : { planets, from, fromId: cut.from, count: cut.planets.length };
}
