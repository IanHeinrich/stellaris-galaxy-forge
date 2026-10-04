import type { FeZone } from "../generated/FeZone";
import type { Op } from "../generated/Op";
import type { SpawnScript } from "../generated/SpawnScript";
import { counted } from "./text";

type Entries<T> = ReadonlyArray<readonly [number, T]>;

/**
 * One edit per system as one undo step: the op alone for one system, else a Batch named
 * "`what` N systems".
 */
function systemsBatch<T>(
  entries: Entries<T>,
  what: string,
  op: (system: number, value: T) => Op,
): Op {
  const ops = entries.map(([system, value]) => op(system, value));
  if (ops.length === 1) return ops[0];
  return { type: "Batch", description: `${what} ${counted(ops.length, "system")}`, ops };
}

export function initializersOp(entries: Entries<string | null>): Op {
  return systemsBatch(entries, "Set initializer of", (system, initializer) => ({
    type: "SetInitializer",
    system,
    initializer,
  }));
}

export function spawnWeightsOp(entries: Entries<number | null>): Op {
  return systemsBatch(entries, "Set the spawn weight of", (system, base) => ({
    type: "SetSpawnWeight",
    system,
    base,
  }));
}

export function spawnScriptsOp(entries: Entries<SpawnScript | null>): Op {
  return systemsBatch(entries, "Set the scripted spawn of", (system, script) => ({
    type: "SetSpawnScript",
    system,
    script,
  }));
}

/** Each entry's zone as its own op, for a Batch the caller names. */
export function feZoneOps(entries: Entries<FeZone | null>): Op[] {
  return entries.map(([system, zone]) => ({ type: "SetFeZone", system, zone }));
}
