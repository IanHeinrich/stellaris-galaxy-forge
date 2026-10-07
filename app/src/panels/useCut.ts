import { documentCapabilities } from "../lib/capabilities";
import type { MovedPlanet, WarningNames } from "../lib/planetMove";
import { useFileSessionStore } from "../store/fileSessionStore";
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

/** What waits for a paste: cut planets and the system they stand in, or copied planets. */
export type Clipboard =
  | { kind: "cut"; planets: MovedPlanet[]; from: string; fromId: number; count: number }
  | { kind: "copy"; planets: readonly MovedPlanet[]; count: number };

/** The planets waiting for a paste; null with none, or with a copy this document cannot take. */
export function useClipboard(): Clipboard | null {
  const cut = usePlanetMoveStore((s) => s.cut);
  const copy = usePlanetMoveStore((s) => s.copy);
  const takesCopy = useFileSessionStore((s) => documentCapabilities(s).add_bodies);
  const planets = useMovedPlanets(cut?.planets ?? NONE);
  const from = useGalaxyStore((s) => (cut === null ? "" : s.systemName(cut.from)));
  if (cut !== null) {
    return { kind: "cut", planets, from, fromId: cut.from, count: cut.planets.length };
  }
  if (copy === null || !takesCopy) return null;
  return { kind: "copy", planets: copy.planets, count: copy.copies.length };
}
