import type { NameTemplate } from "../../../generated/NameTemplate";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyName, shownBodyName } from "../../../lib/details/labels";
import { givenNamesFrom, nameFormats, type GivenName } from "../../../lib/details/spawnNames";
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

interface KeptNames {
  systemName: NameTemplate | undefined;
  names: ReadonlyMap<string, string>;
  formats: ReadonlyMap<string, string>;
  given: ReadonlyMap<number, GivenName>;
}

// Kept per planet list rather than with useMemo, so the menus that read it run outside a render.
const GIVEN = new WeakMap<readonly PlanetSummary[], KeptNames>();

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
  if (planets === undefined) return givenNamesFrom(planets, systemName, names, formats);
  const kept = GIVEN.get(planets);
  if (
    kept !== undefined &&
    kept.systemName === systemName &&
    kept.names === names &&
    kept.formats === formats
  ) {
    return kept.given;
  }
  const given = givenNamesFrom(planets, systemName, names, formats);
  GIVEN.set(planets, { systemName, names, formats, given });
  return given;
}

/** A body's name as a list or link shows it: the lowest it can have, and whether its numeral is rolled. */
export interface ListedBodyName {
  text: string;
  rolled: boolean;
}

/**
 * The names of system `system`'s bodies as lists and links show them, undefined for one it doesn't
 * list: a scenario's body ids repeat from one system to the next.
 */
export function useSystemBodyNames(system: number): (id: number) => ListedBodyName | undefined {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details.get(system));
  const given = useGivenNames(details);
  return (id) => {
    const planet = details?.planets.find((p) => p.id === id);
    if (planet === undefined) return undefined;
    return { text: shownBodyName(planet, given, names), rolled: given.get(id)?.rolled ?? false };
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
