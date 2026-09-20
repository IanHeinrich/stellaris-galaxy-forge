import type { Op } from "../../../../../generated/Op";
import type { SpawnModifier } from "../../../../../generated/SpawnModifier";
import type { SpawnReservation } from "../../../../../generated/SpawnReservation";
import type { SpawnReservationPreset } from "../../../../../generated/SpawnReservationPreset";
import type { SystemNode } from "../../../../../generated/SystemNode";

/** The weight a system takes the moment it is made a spawn point. */
export const DEFAULT_SPAWN_WEIGHT = 1;

/** Why a system with no initializer cannot be made a spawn point, wherever the control sits. */
export const NEEDS_INITIALIZER =
  "A spawn weight is written beside the initializer: choose one first.";

/** Why a system the generator never starts an empire in cannot hold a reservation. */
export const NEEDS_SPAWN_POINT =
  "A reservation is written inside the spawn weight: make this a spawn point first.";

/** The systems in `ids` a spawn weight can be written to: only one with an initializer can take it. */
export function spawnTargets(
  ids: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
): SystemNode[] {
  return ids
    .map((id) => systems.get(id))
    .filter((s): s is SystemNode => s !== undefined && s.initializer !== "");
}

/**
 * The weight the generator gives this system when it places an empire, written as
 * `spawn_weight = { base = N }` and removed by `null`. The initializer beside it is a separate
 * statement with a separate op, and the modifiers in the block are left exactly as they stand.
 */
export function spawnPointOp(system: SystemNode, weight: number | null): Op {
  return { type: "SetSpawnWeight", id: system.id, base: weight };
}

/**
 * The same weight over every system in `ids` that can carry one, as a single undo step; `null`
 * when none of them can. One system keeps the plain op, whose description names it.
 */
export function spawnPointsOp(
  ids: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
  on: boolean,
): Op | null {
  const targets = spawnTargets(ids, systems);
  const base = on ? DEFAULT_SPAWN_WEIGHT : null;
  if (targets.length === 0) return null;
  if (targets.length === 1) return spawnPointOp(targets[0], base);
  return { type: "SetSpawnWeights", entries: targets.map((s) => [s.id, base]) };
}

/**
 * Keeps this system for a human player or for the AI, the two being exclusive, or lets the
 * generator seat anyone here again.
 */
export function spawnReservationOp(id: number, preset: SpawnReservationPreset | null): Op {
  return { type: "SetSpawnReservation", id, reserve: preset };
}

/** What a modifier does to the weight, as the file writes it; empty when it states neither. */
export function modifierAmount(modifier: SpawnModifier): string {
  const parts: string[] = [];
  if (modifier.factor !== null) parts.push(`×${modifier.factor}`);
  if (modifier.add !== null) parts.push(modifier.add < 0 ? `${modifier.add}` : `+${modifier.add}`);
  return parts.join(" ");
}

/** Who a recognised reservation seats here, in a word. */
export function reservationLabel(reservation: SpawnReservation): string {
  if (reservation === "human") return "human";
  if (reservation === "ai") return "AI";
  return `flag: ${reservation.country_flag}`;
}
