import type { SystemNode } from "../generated/SystemNode";

/** Whether a modifier already holds this system for a human player. */
export function isHumanReserved(system: SystemNode): boolean {
  return system.spawn_modifiers.some((m) => m.reservation === "human");
}

/** Whether a modifier holds this system for the AI instead, barring human players from it. */
export function isAiReserved(system: SystemNode): boolean {
  return system.spawn_modifiers.some((m) => m.reservation === "ai");
}

/** Zero or less never places an empire, so the field refuses it rather than writing it. */
export function isSpawnWeight(weight: number): boolean {
  return weight > 0;
}

/**
 * Whether the generator draws this system at all, which a reservation needs it to: a base
 * above zero, a modifier that adds weight on its own (a mod's `base = 0` plus `add = 10000`
 * for one empire is a spawn point for that empire), or a script that names the seat.
 */
export function isSpawnPoint(system: SystemNode): boolean {
  if (system.spawn_weight !== null && isSpawnWeight(system.spawn_weight)) return true;
  if (system.spawn_script !== null) return true;
  return system.spawn_modifiers.some((m) => (m.add ?? 0) > 0);
}
