/**
 * Adding a megastructure of a type the install defines to a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_megastructure.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedMegastructure } from "../generated/AddedMegastructure";
import type { MegastructurePlace } from "../generated/MegastructurePlace";

/**
 * Add a finished megastructure of type `kind` to system `system` of the open save as one edit,
 * at `place`, owned by the system's owner as the game makes it. The core writes the bypass, the
 * ruin flag and what its construction adds as the type's definition asks. A type whose build
 * changes its planet's class or size changes the planet too, in the same edit, unless
 * `keepPlanet`. Answers with the edit, the new row's id and the construction effects left out;
 * refused without game data and for a type the editor does not add.
 */
export function addMegastructure(
  system: number,
  kind: string,
  place: MegastructurePlace,
  keepPlanet = false,
): Promise<AddedMegastructure> {
  return invoke<AddedMegastructure>("add_megastructure", { system, kind, place, keepPlanet });
}
