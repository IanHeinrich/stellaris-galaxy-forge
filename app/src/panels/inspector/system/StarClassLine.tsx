import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemNode } from "../../../generated/SystemNode";
import { starMismatch } from "../../../lib/details/starBody";
import { currentStarBodies } from "../../../lib/details/starClass";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useNamed } from "./useStarNames";

export const READING_STARS = "Reading the system's stars…";

/**
 * The line under a save system's head when no star class has the stars its bodies are, as after
 * one star's type was changed. It waits for details read since the last edit.
 */
export function StarMismatchNote({
  system,
  planets,
  label,
}: {
  system: SystemNode;
  planets: readonly PlanetSummary[] | undefined;
  label: string;
}) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const stale = useDetailsStore((s) => s.stale.has(system.id));
  const read = planets === undefined ? undefined : { planets };
  const fresh = currentStarBodies(read, stale, planetClasses, starClasses);
  const bodies = fresh?.map((body) => body.class) ?? [];
  const mismatch = starMismatch(bodies, starClasses.get(system.star_class));
  const named = useNamed(mismatch ?? []);
  if (mismatch === null) return null;
  return (
    <div className="ins-sub muted">
      {`No star class has these stars (${mismatch.map(named).join(" + ")}). The map and the game treat the system as ${label}.`}
    </div>
  );
}
