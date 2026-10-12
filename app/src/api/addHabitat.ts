/**
 * Adding the habitat a megastructure type's finished stage is to a body of a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_habitat.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedHabitat } from "../generated/AddedHabitat";

/**
 * Add the habitat finishing a megastructure of type `kind` at body `body` of system `system`
 * leaves, as one edit: a planet round the body with no owner, drawn in the culture of the
 * system's owner. Answers with the edit and the new planet's id; refused without game data and
 * for a type whose finished stage is not a habitat.
 */
export function addHabitat(system: number, body: number, kind: string): Promise<AddedHabitat> {
  return invoke<AddedHabitat>("add_habitat", { system, body, kind });
}
