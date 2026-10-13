/**
 * Adding a ring world round the star of a save system, and what clearing the system for it
 * takes. Command and argument names match `app/src-tauri/src/commands/add_ring_world.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";

/**
 * Calls `add_ring_world`: add the ring world of megastructure type `kind` round the star of
 * system `system`, each quadrant at its stage in `stages`, clearing the system first with `clear`.
 * The command's doc says what it decides and refuses.
 */
export function addRingWorld(
  system: number,
  kind: string,
  stages: RingStage[],
  clear: boolean,
): Promise<Added> {
  return invoke<Added>("add_ring_world", { system, kind, stages, clear });
}

/** Calls `get_ring_world_clearing`: what clearing system `system` for a ring world takes. */
export function getRingWorldClearing(system: number): Promise<RingWorldClearing> {
  return invoke<RingWorldClearing>("get_ring_world_clearing", { system });
}
