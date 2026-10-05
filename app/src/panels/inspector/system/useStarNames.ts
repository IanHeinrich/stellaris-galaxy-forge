import type { SystemNode } from "../../../generated/SystemNode";
import { eachStarKeys } from "../../../lib/details/starBody";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useNamed } from "../../useNamed";

/**
 * A save system's star class as plain text. Every binary is called "Binary Stars", so a multiple
 * star is named by its class's bodies.
 */
export function useStarClassLabel(system: SystemNode, fallback: string): string {
  const own = useGameDataStore((s) => s.starClasses.get(system.star_class));
  const bodyKeys = eachStarKeys(own);
  const named = useNamed(bodyKeys);
  return bodyKeys.length > 0 ? bodyKeys.map(named).join(" + ") : fallback;
}
