/**
 * Adding a ring world round the star of a save system, and what clearing the system for it
 * takes. Command and argument names match `app/src-tauri/src/commands/add_ring_world.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";

/**
 * Add the ring world of megastructure type `kind`, any stage of its chain, round the star of
 * system `system`, each quadrant at its stage in `stages`, as one edit; with `clear`, every body
 * that is not a star and every belt go first. Answers with the edit and the ids of the planets and
 * rows it wrote; see the command for the owner it takes and what it refuses.
 */
export function addRingWorld(
  system: number,
  kind: string,
  stages: RingStage[],
  clear: boolean,
): Promise<Added> {
  return invoke<Added>("add_ring_world", { system, kind, stages, clear });
}

/** What clearing system `system` for a ring world takes: its bodies, colonies and belts. */
export function getRingWorldClearing(system: number): Promise<RingWorldClearing> {
  return invoke<RingWorldClearing>("get_ring_world_clearing", { system });
}
