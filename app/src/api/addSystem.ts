/**
 * Rolling systems into a save, and what the Add system menu offers.
 * Command and argument names match `app/src-tauri/src/commands/add_system.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { EditResult } from "../generated/EditResult";
import type { StarClassPick } from "../generated/StarClassPick";

/**
 * Roll a system at (x, y) from `seed`, around `starClass` when given, and add it to the open save
 * as one edit. Rejects with `SgfError` (kind `op`) without game data, on a scenario, or when the
 * core refuses the spot.
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
 * Build a system of the special layout `layout` at (x, y) from `seed` and add it to the open save
 * as one edit. It takes the layout's fixed name unless the save already has it. A capped layout
 * the galaxy already holds is placed all the same.
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
 * Roll the added save system `system` again from `seed`, keeping its name, position and lanes, as
 * one edit. With `keepSpecial`, a system of a Special menu layout is built from that layout again;
 * otherwise it is rolled around `starClass` when given.
 */
export function rerollSystem(
  system: number,
  seed: number,
  starClass: string | null,
  keepSpecial: boolean,
): Promise<EditResult> {
  return invoke<EditResult>("reroll_system", { system, seed, starClass, keepSpecial });
}

/**
 * What the Add system menu offers for the open save, each pick with what it can produce. Rejects
 * without game data or on a scenario.
 */
export function getAddSystemPicks(): Promise<AddSystemPicks> {
  return invoke<AddSystemPicks>("get_add_system_picks");
}

/**
 * Delete the systems among `ids` added to the open save this session as one edit, leaving the
 * file's own. Rejects with `SgfError` (kind `op`) on a scenario or when none of them was added.
 */
export function removeAddedSystems(ids: number[]): Promise<EditResult> {
  return invoke<EditResult>("remove_added_systems", { ids });
}

/**
 * The star classes a rolled system can have, each with its localised name, in the order the
 * install's layouts name them; empty without game data.
 */
export function getGeneratorStarClasses(): Promise<StarClassPick[]> {
  return invoke<StarClassPick[]>("get_generator_star_classes");
}
