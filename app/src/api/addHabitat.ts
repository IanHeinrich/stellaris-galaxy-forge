/**
 * Adding the habitat a megastructure type's finished stage is to a body of a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_habitat.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";

/**
 * Calls `add_habitat`: add the habitat that finishing a megastructure of type `kind` leaves at
 * body `body` of system `system`. The command's doc says what it decides and refuses.
 */
export function addHabitat(system: number, body: number, kind: string): Promise<Added> {
  return invoke<Added>("add_habitat", { system, body, kind });
}
