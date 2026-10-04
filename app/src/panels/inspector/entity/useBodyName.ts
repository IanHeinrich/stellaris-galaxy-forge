import { bodyName } from "../../../lib/details/labels";
import { findPlanet } from "../../../lib/details/starBody";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";

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

/**
 * The names of system `system`'s bodies only, undefined for one it doesn't list: a scenario's body
 * ids repeat from one system to the next.
 */
export function useSystemBodyNamer(system: number): (id: number) => string | undefined {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details.get(system));
  return (id) => {
    const planet = details?.planets.find((p) => p.id === id);
    return planet === undefined ? undefined : bodyName(planet, names);
  };
}
