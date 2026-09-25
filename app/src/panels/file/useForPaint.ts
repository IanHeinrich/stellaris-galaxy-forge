import type { ScenarioListing } from "../../generated/ScenarioListing";
import { scenarioForPaint } from "../../lib/paint";
import { usePaintModStore } from "../../store/paintModStore";

/** Whether the scenario file at `path` is for Paint a Galaxy, by `listings` and the mod's folder. */
export function useForPaint(
  path: string,
  listings: readonly ScenarioListing[] | null,
): boolean | null {
  const paintMod = usePaintModStore((s) => s.paintMod);
  return scenarioForPaint(path, listings, paintMod);
}
