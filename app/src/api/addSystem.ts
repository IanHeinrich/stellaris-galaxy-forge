/**
 * Rolling systems into a save, and what the Add system menu offers.
 * Command and argument names match `app/src-tauri/src/commands/add_system.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { Arrangement } from "../generated/Arrangement";
import type { EditResult } from "../generated/EditResult";
import type { LaneEnd } from "../generated/LaneEnd";
import type { StarClassPick } from "../generated/StarClassPick";
import type { StarType } from "../generated/StarType";
import type { SystemAsk } from "../generated/SystemAsk";
import type { SystemPick } from "../generated/SystemPick";

/**
 * Calls `add_random_system`: roll a system at (x, y) from `seed` as `pick` says. The command's
 * doc says what it refuses.
 */
export function addRandomSystem(
  seed: number,
  x: number,
  y: number,
  pick: SystemPick,
): Promise<EditResult> {
  return invoke<EditResult>("add_random_system", { seed, x, y, pick });
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

/** A system built from chosen stars: its layout, its stars in slot order, its class and its planets. */
export interface BuiltStars {
  layout: string;
  stars: string[];
  /** The class the system is filed under; null files it as `fileStarClass` does. */
  starClass: string | null;
  /** False adds the stars alone, with no planets, moons or belts. */
  planets: boolean;
}

/**
 * Calls `add_built_system`: build a system at (x, y) from `seed` in the plain layout of `built`
 * with its stars in the star slots, joined by a lane to each system of `links`, as one edit. The
 * command's doc says what it refuses.
 */
export function addBuiltSystem(
  seed: number,
  x: number,
  y: number,
  { layout, stars, starClass, planets }: BuiltStars,
  links: number[],
): Promise<EditResult> {
  return invoke<EditResult>("add_built_system", {
    seed,
    x,
    y,
    layout,
    stars,
    starClass,
    planets,
    links,
  });
}

/**
 * Calls `reroll_system`: roll the added save system `system` again from `seed` as `pick` says,
 * keeping its name, position and lanes. The command's doc says what it refuses.
 */
export function rerollSystem(system: number, seed: number, pick: SystemPick): Promise<EditResult> {
  return invoke<EditResult>("reroll_system", { system, seed, pick });
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

/** Calls `get_star_arrangements`: the plain layouts of several stars the builder arranges stars in. */
export function getStarArrangements(): Promise<Arrangement[]> {
  return invoke<Arrangement[]>("get_star_arrangements");
}

/** Calls `get_star_types`: every star type a slot of the builder offers, the usual ones first. */
export function getStarTypes(): Promise<StarType[]> {
  return invoke<StarType[]>("get_star_types");
}

/** Calls `file_star_class`: the star class a system of `stars`, in slot order, is filed under. */
export function fileStarClass(stars: string[]): Promise<string> {
  return invoke<string>("file_star_class", { stars });
}
