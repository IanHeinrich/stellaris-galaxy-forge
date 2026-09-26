import { useMemo } from "react";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { resolveBodyClasses, type ResolvedClass } from "../../../lib/details/bodyClass";
import { singleStarClasses } from "../../../lib/details/starBody";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";

/** The star class each planet class makes on its own, for the icons. */
export function useSingleStarClasses() {
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => singleStarClasses(starClasses), [starClasses]);
}

/** Body `id` of `details` as the system view resolves it: the class and star class it draws. */
export function useResolvedClass(details: SystemDetails, id: number): ResolvedClass | undefined {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const initializerClasses = useGameDataStore((s) => s.initializerClasses);
  const kind = useFileSessionStore((s) => s.kind);
  const node = useGalaxyStore((s) => s.systems.get(details.id)) ?? null;
  return useMemo(() => {
    const src = { planetClasses, starClasses, initializerClasses, kind };
    return resolveBodyClasses(details.planets, node, src).get(id);
  }, [details, id, node, planetClasses, starClasses, initializerClasses, kind]);
}
