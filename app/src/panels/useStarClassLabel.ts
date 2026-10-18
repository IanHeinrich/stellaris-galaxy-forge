import type { PickSummary } from "../generated/PickSummary";
import { multiStarNameKeys, starClassLabel } from "../lib/details/starClass";
import { useGameDataStore } from "../store/gameDataStore";
import { useNamed } from "./useNamed";

/**
 * Names each multiple star among `keys` by its bodies, as the star class picker does, asking for
 * their names as they are shown. Any other class keeps the name it is given.
 */
export function useStarClassLabel(keys: readonly string[]): (key: string, name: string) => string {
  const views = useGameDataStore((s) => s.starClasses);
  const named = useNamed(multiStarNameKeys(keys, views));
  return (key, name) => starClassLabel(views.get(key), name, named);
}

/** `summary` with each multiple star it lists named by its bodies, as its menu row is. */
export function useStarNamedSummary(summary: PickSummary): PickSummary;
export function useStarNamedSummary(summary: PickSummary | undefined): PickSummary | undefined;
export function useStarNamedSummary(summary: PickSummary | undefined): PickSummary | undefined {
  const stars = summary?.star_classes ?? [];
  const label = useStarClassLabel(stars.map((c) => c.key));
  if (summary === undefined) return undefined;
  return { ...summary, star_classes: stars.map((c) => ({ ...c, name: label(c.key, c.name) })) };
}
