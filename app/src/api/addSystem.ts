/**
 * Rolling systems into a save, and what the Add system menu offers.
 * Command and argument names match `app/src-tauri/src/commands/add_system.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { EditResult } from "../generated/EditResult";
import type { StarClassPick } from "../generated/StarClassPick";

/**
 * Calls `add_random_system`: roll a system at (x, y) from `seed`, around `starClass` when given.
 * The command's doc says what it refuses.
 */
export function addRandomSystem(
  seed: number,
  x: number,
  y: number,
  starClass: string | null,
): Promise<EditResult> {
  return invoke<EditResult>("add_random_system", { seed, x, y, starClass });
}

/**
 * Calls `add_special_system`: build a system of the special layout `layout` at (x, y) from
 * `seed`. The command's doc says how it is named and what it refuses.
 */
export function addSpecialSystem(
  seed: number,
  x: number,
  y: number,
  layout: string,
): Promise<EditResult> {
  return invoke<EditResult>("add_special_system", { seed, x, y, layout });
}

/**
 * Calls `reroll_system`: roll the added save system `system` again from `seed`, around
 * `starClass` when given, or from its own special layout with `keepSpecial`.
 */
export function rerollSystem(
  system: number,
  seed: number,
  starClass: string | null,
  keepSpecial: boolean,
): Promise<EditResult> {
  return invoke<EditResult>("reroll_system", { system, seed, starClass, keepSpecial });
}

/** Calls `get_add_system_picks`: what the Add system menu offers for the open save. */
export function getAddSystemPicks(): Promise<AddSystemPicks> {
  return invoke<AddSystemPicks>("get_add_system_picks");
}

/** Calls `remove_added_systems`: delete the systems among `ids` added this session. */
export function removeAddedSystems(ids: number[]): Promise<EditResult> {
  return invoke<EditResult>("remove_added_systems", { ids });
}

/** Calls `get_generator_star_classes`: the star classes a rolled system can have. */
export function getGeneratorStarClasses(): Promise<StarClassPick[]> {
  return invoke<StarClassPick[]>("get_generator_star_classes");
}
