import { useMemo } from "react";
import { singleStarClasses } from "../../../lib/details/starBody";
import { useGameDataStore } from "../../../store/gameDataStore";

/** A class's localised name, or its key until the name arrives. */
export function useClassLabel(): (key: string) => string {
  const names = useGameDataStore((s) => s.names);
  return (key) => names.get(key) ?? key;
}

/** The star class each planet class makes on its own, for the icons. */
export function useSingleStarClasses() {
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => singleStarClasses(starClasses), [starClasses]);
}
