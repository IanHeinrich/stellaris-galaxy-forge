import { useMemo } from "react";
import { singleStarClasses } from "../../../lib/details/starBody";
import { useGameDataStore } from "../../../store/gameDataStore";

/** The star class each planet class makes on its own, for the icons. */
export function useSingleStarClasses() {
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => singleStarClasses(starClasses), [starClasses]);
}
