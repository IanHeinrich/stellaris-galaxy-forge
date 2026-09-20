import type { Systems } from "./RenderContext";

/** Initializer browser row ids that stand for "no initializer" (the game's random pick). */
function isRandomKey(key: string): boolean {
  return key === "" || key === "@random";
}

/** The ids of every system in `systems` using initializer `key`, in one pass. */
export function matchingSystems(systems: Systems, key: string): Set<number> {
  const random = isRandomKey(key);
  const ids = new Set<number>();
  for (const [id, system] of systems) {
    if (random ? system.initializer === "" : system.initializer === key) ids.add(id);
  }
  return ids;
}
