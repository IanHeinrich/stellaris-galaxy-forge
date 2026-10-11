import { useMemo } from "react";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyName } from "../../../lib/details/labels";
import {
  givenNamesFrom,
  listedName,
  nameFormats,
  type GivenName,
} from "../../../lib/details/spawnNames";
import { findPlanet } from "../../../lib/details/starBody";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";

/** Body `id` as the system list names it, and whether it is a moon; `#id` while no read system lists it. */
export function useBodyLookup(): (id: number) => { name: string; moon: boolean } {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details);
  return (id) => {
    const found = findPlanet(details, id);
    if (found === null) return { name: `#${id}`, moon: false };
    return { name: bodyName(found.planet, names), moon: found.planet.moon === true };
  };
}

/** Body `id` as the system list names it, or `#id` while no read system lists it. */
export function useBodyName(id: number): string {
  return useBodyLookup()(id).name;
}

/** The name formats as the install writes them, asking for those `planets` use and are not read. */
function useFormats(planets: readonly PlanetSummary[] | undefined): ReadonlyMap<string, string> {
  const formats = useNameFormatsStore((s) => s.formats);
  if (planets !== undefined) {
    const wanted = nameFormats(planets).filter((key) => !formats.has(key));
    if (wanted.length > 0) useNameFormatsStore.getState().request(wanted);
  }
  return formats;
}

/**
 * The names the game gives a scenario system's bodies, by id, made from the system's name as it
 * stands; empty for a save's.
 */
export function useGivenNames(
  details: Pick<SystemDetails, "id" | "planets"> | undefined,
): ReadonlyMap<number, GivenName> {
  const names = useGameDataStore((s) => s.names);
  const systemName = useGalaxyStore((s) => s.systems.get(details?.id ?? -1)?.name);
  const planets = details?.planets;
  const formats = useFormats(planets);
  return useMemo(
    () => givenNamesFrom(planets, systemName, names, formats),
    [planets, systemName, names, formats],
  );
}

/** A body's name as the system list shows it: the name the game gives a scenario body, where told. */
export function shownBodyName(
  planet: PlanetSummary,
  given: ReadonlyMap<number, GivenName>,
  names: ReadonlyMap<string, string>,
): string {
  return given.get(planet.id)?.text ?? bodyName(planet, names);
}

/** A body's name as a list or link shows it, whether its numeral is rolled, and its page's name. */
export interface ListedBodyName {
  text: string;
  rolled: boolean;
  /** The name its page heads and its breadcrumb shows: the lowest it can have. */
  page: string;
}

/**
 * The names of system `system`'s bodies as lists and links show them, undefined for one it doesn't
 * list: a scenario's body ids repeat from one system to the next.
 */
export function useSystemBodyNames(system: number): (id: number) => ListedBodyName | undefined {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details.get(system));
  const systemName = useGalaxyStore((s) => s.systems.get(system)?.name);
  const formats = useFormats(details?.planets);
  const given = givenNamesFrom(details?.planets, systemName, names, formats);
  return (id) => {
    const planet = details?.planets.find((p) => p.id === id);
    if (planet === undefined) return undefined;
    const own = given.get(id);
    if (own === undefined) {
      const text = bodyName(planet, names);
      return { text, rolled: false, page: text };
    }
    return { text: listedName(own), rolled: own.rolled, page: own.text };
  };
}

/**
 * The names of system `system`'s bodies only, undefined for one it doesn't list: a scenario's body
 * ids repeat from one system to the next.
 */
export function useSystemBodyNamer(system: number): (id: number) => string | undefined {
  const named = useSystemBodyNames(system);
  return (id) => named(id)?.text;
}
