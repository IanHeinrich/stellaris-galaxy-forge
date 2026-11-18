import { useEffect } from "react";
import type { AmbientObjectView } from "../generated/AmbientObjectView";
import { AMBIENT_OBJECTS_NEED_GAME_DATA, ambientObjectsUnread } from "../lib/ambientObjectAdd";
import { useGameDataStore } from "../store/gameDataStore";

/**
 * The ambient objects of the loaded game data, read on first use and again after each reload;
 * null until read. `problem` says why there are none: game data not loaded, or a read that failed.
 */
export function useAmbientObjectViews(): {
  views: ReadonlyMap<string, AmbientObjectView> | null;
  problem: string | null;
} {
  const ready = useGameDataStore((s) => s.status === "ready");
  const version = useGameDataStore((s) => s.version);
  const views = useGameDataStore((s) => s.ambientObjects);
  const error = useGameDataStore((s) => s.ambientObjectsError);
  const load = useGameDataStore((s) => s.loadAmbientObjects);
  useEffect(() => {
    if (ready) void load();
  }, [ready, version, load]);
  if (!ready) return { views: null, problem: AMBIENT_OBJECTS_NEED_GAME_DATA };
  if (views === null && error !== null)
    return { views: null, problem: ambientObjectsUnread(error) };
  return { views, problem: null };
}
