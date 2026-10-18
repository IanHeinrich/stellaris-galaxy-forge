/**
 * Rolling systems into a save, and what the Add system menu offers.
 * Command and argument names match `app/src-tauri/src/commands/add_system.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { EditResult } from "../generated/EditResult";
import type { LaneEnd } from "../generated/LaneEnd";
import type { StarClassPick } from "../generated/StarClassPick";
import type { SystemAsk } from "../generated/SystemAsk";

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

/** What `addRandomSystems` sends: each system's place and star class, and the lanes between them. */
export interface RandomSystems {
  seed: number;
  systems: SystemAsk[];
  lanes: Array<[LaneEnd, LaneEnd]>;
  description: string;
}

/**
 * Calls `add_random_systems`: roll a system at each of `systems` around its star class, all from
 * `seed`, and add them with `lanes` as one edit. The command's doc says what it refuses.
 */
export function addRandomSystems({
  seed,
  systems,
  lanes,
  description,
}: RandomSystems): Promise<EditResult> {
  return invoke<EditResult>("add_random_systems", { seed, systems, lanes, description });
}

/**
 * Calls `add_special_system`: build a system of the special layout `layout` at (x, y) from
 * `seed`, with its anomalies and dig sites when `extras`, joined by a lane to each system of
 * `links`. The command's doc says how it is named and what it refuses.
 */
export function addSpecialSystem(
  seed: number,
  x: number,
  y: number,
  layout: string,
  extras: boolean,
  links: number[],
): Promise<EditResult> {
  return invoke<EditResult>("add_special_system", { seed, x, y, layout, extras, links });
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
