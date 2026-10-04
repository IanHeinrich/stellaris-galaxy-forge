import { useMemo } from "react";
import { bodyName } from "../../../lib/details/labels";
import { findPlanet } from "../../../lib/details/starBody";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";

/** Body `id` as the system list names it, or `#id` while no read system lists it. */
export function useBodyName(id: number): string {
  const names = useGameDataStore((s) => s.names);
  const details = useDetailsStore((s) => s.details);
  const found = useMemo(() => findPlanet(details, id), [details, id]);
  return found === null ? `#${id}` : bodyName(found.planet, names);
}
