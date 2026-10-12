/**
 * Adding a ring world round the star of a save system, and what clearing the system for it
 * takes. Command and argument names match `app/src-tauri/src/commands/add_ring_world.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedRingWorld } from "../generated/AddedRingWorld";
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";

/**
 * Add the ring world of megastructure type `kind`, any stage of its chain, round the star of
 * system `system`, each quadrant at its stage in `stages`, as one edit. Rows that take an owner are
 * `owner`'s, in its culture. With `clear`, every body that is not a star and every belt go
 * first; without it they stay. Answers with the edit and the ids of the planets and rows it
 * wrote; refused without game data, and for a clearing that would delete a planet a starbase
 * orbits.
 */
export function addRingWorld(
  system: number,
  kind: string,
  stages: RingStage[],
  owner: number | null,
  clear: boolean,
): Promise<AddedRingWorld> {
  return invoke<AddedRingWorld>("add_ring_world", { system, kind, stages, owner, clear });
}

/** What clearing system `system` for a ring world takes: its bodies, colonies and belts. */
export function getRingWorldClearing(system: number): Promise<RingWorldClearing> {
  return invoke<RingWorldClearing>("get_ring_world_clearing", { system });
}
