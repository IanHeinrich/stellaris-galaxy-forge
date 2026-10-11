import { useMemo } from "react";
import type { NameTemplate } from "../../../generated/NameTemplate";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyName } from "../../../lib/details/labels";
import { givenNames, nameFormats, type GivenName } from "../../../lib/details/spawnNames";
import { findPlanet } from "../../../lib/details/starBody";
import { displayNameIn, nodeNameIn, templateName } from "../../../lib/names";
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

/** The names the game gives a scenario system's bodies, by id, made from `systemName` as it stands. */
function givenNamesOf(
  planets: readonly PlanetSummary[] | undefined,
  systemName: NameTemplate | undefined,
  names: ReadonlyMap<string, string>,
  formats: ReadonlyMap<string, string>,
): ReadonlyMap<number, GivenName> {
  if (planets === undefined || !planets.some((p) => p.spawn?.naming !== undefined)) {
    return NO_NAMES;
  }
  const system =
    systemName === undefined || systemName.key === "" ? "" : nodeNameIn(names, systemName);
  return givenNames(planets, system, {
    format: (key) => formats.get(key),
    stated: (planet, name) =>
      name === planet.name_key && templateName(planet) !== ""
        ? templateName(planet)
        : displayNameIn(names, name),
  });
}

const NO_NAMES: ReadonlyMap<number, GivenName> = new Map();

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
    () => givenNamesOf(planets, systemName, names, formats),
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

/**
 * The names of system `system`'s bodies only, undefined for one it doesn't list: a scenario's body
 * ids repeat from one system to the next.
 */
export function useSystemBodyNamer(system: number): (id: number) => string | undefined {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details.get(system));
  const systemName = useGalaxyStore((s) => s.systems.get(system)?.name);
  const formats = useFormats(details?.planets);
  const given = givenNamesOf(details?.planets, systemName, names, formats);
  return (id) => {
    const planet = details?.planets.find((p) => p.id === id);
    return planet === undefined ? undefined : shownBodyName(planet, given, names);
  };
}
