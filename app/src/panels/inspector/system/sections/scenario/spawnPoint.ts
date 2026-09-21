import type { Op } from "../../../../../generated/Op";
import type { SpawnModifier } from "../../../../../generated/SpawnModifier";
import type { SystemNode } from "../../../../../generated/SystemNode";
import { enabledScript } from "../../../../../lib/paint";

/** The weight a system takes the moment it is made a spawn point. */
export const DEFAULT_SPAWN_WEIGHT = 1;

/** Why a system with no initializer cannot be made a spawn point, wherever the control sits. */
export const NEEDS_INITIALIZER =
  "A spawn weight is written beside the initializer: choose one first.";

/**
 * The systems in `ids` a spawn weight can be written to: only one with an initializer can take
 * it, except under the Paint a Galaxy profile, where the script's op writes a starting
 * initializer beside itself for a system that names none.
 */
export function spawnTargets(
  ids: readonly number[],
  systems: ReadonlyMap<number, SystemNode>,
  paint: boolean,
): SystemNode[] {
  return ids
    .map((id) => systems.get(id))
    .filter((s): s is SystemNode => s !== undefined && (paint || s.initializer !== ""));
}

/**
 * The weight the generator gives this system when it places an empire, written as
 * `spawn_weight = { base = N }` and removed by `null`. Under the Paint a Galaxy profile the
 * weight is the site's script instead, which any weight marks and `null` clears. The
 * initializer beside it is a separate statement with a separate op, and the modifiers in the
 * block are left exactly as they stand.
 */
export function spawnPointOp(system: SystemNode, weight: number | null, paint: boolean): Op {
  if (paint) {
    return {
      type: "SetSpawnScript",
      id: system.id,
      script: weight === null ? null : (system.spawn_script ?? enabledScript(system)),
    };
  }
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
  paint: boolean,
): Op | null {
  const targets = spawnTargets(ids, systems, paint);
  const base = on ? DEFAULT_SPAWN_WEIGHT : null;
  if (targets.length === 0) return null;
  if (targets.length === 1) return spawnPointOp(targets[0], base, paint);
  if (paint) {
    return {
      type: "SetSpawnScripts",
      entries: targets.map((s) => [s.id, on ? (s.spawn_script ?? enabledScript(s)) : null]),
    };
  }
  return { type: "SetSpawnWeights", entries: targets.map((s) => [s.id, base]) };
}

/** What a modifier does to the weight, as the file writes it; empty when it states neither. */
export function modifierAmount(modifier: SpawnModifier): string {
  const parts: string[] = [];
  if (modifier.factor !== null) parts.push(`×${modifier.factor}`);
  if (modifier.add !== null) parts.push(modifier.add < 0 ? `${modifier.add}` : `+${modifier.add}`);
  return parts.join(" ");
}

/** The empire a modifier's country flag singles out, chipped beside its trigger. */
export function flagLabel(flag: string): string {
  return `flag: ${flag}`;
}
