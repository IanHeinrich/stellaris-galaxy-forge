/**
 * Adding the habitat a megastructure type's finished stage is to a body of a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_habitat.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";

/**
 * Add the habitat finishing a megastructure of type `kind` at body `body` of system `system`
 * leaves, as one edit. Answers with the edit and the new planet's id, and the orbital's when a
 * restored complex leaves one; see the command for what it decides and refuses.
 */
export function addHabitat(system: number, body: number, kind: string): Promise<Added> {
  return invoke<Added>("add_habitat", { system, body, kind });
}
