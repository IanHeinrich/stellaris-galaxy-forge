/**
 * Adding a megastructure of a type the install defines to a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_megastructure.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedMegastructure } from "../generated/AddedMegastructure";
import type { MegastructurePlace } from "../generated/MegastructurePlace";

/**
 * Calls `add_megastructure`: add a finished megastructure of type `kind` to system `system` at
 * `place`, changing its planet as its build does unless `keepPlanet`. The command's doc says what
 * it decides and refuses.
 */
export function addMegastructure(
  system: number,
  kind: string,
  place: MegastructurePlace,
  keepPlanet = false,
): Promise<AddedMegastructure> {
  return invoke<AddedMegastructure>("add_megastructure", { system, kind, place, keepPlanet });
}
