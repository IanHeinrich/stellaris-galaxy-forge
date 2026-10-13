/**
 * Adding a megastructure of a type the install defines to a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_megastructure.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedMegastructure } from "../generated/AddedMegastructure";
import type { MegastructurePlace } from "../generated/MegastructurePlace";

/**
 * Add a finished megastructure of type `kind` to system `system` of the open save as one edit,
 * at `place`, changing its planet as its build does unless `keepPlanet`. Answers with the edit,
 * the new row's id and the construction effects left out; see the command for what it decides
 * and refuses.
 */
export function addMegastructure(
  system: number,
  kind: string,
  place: MegastructurePlace,
  keepPlanet = false,
): Promise<AddedMegastructure> {
  return invoke<AddedMegastructure>("add_megastructure", { system, kind, place, keepPlanet });
}
