/**
 * Adding a megastructure of a type the install defines to a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_megastructure.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedMegastructure } from "../generated/AddedMegastructure";
import type { MegastructurePlace } from "../generated/MegastructurePlace";

/**
 * Add a finished megastructure of type `kind` to system `system` of the open save as one edit,
 * at `place`, owned by `owner` or by no one for null. The core writes the bypass and the ruin flag
 * the type's definition asks for. Answers with the edit and the new row's id; refused without
 * game data and for a type the editor does not add.
 */
export function addMegastructure(
  system: number,
  kind: string,
  place: MegastructurePlace,
  owner: number | null,
): Promise<AddedMegastructure> {
  return invoke<AddedMegastructure>("add_megastructure", { system, kind, place, owner });
}
