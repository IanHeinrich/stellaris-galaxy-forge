/**
 * Deleting a save's megastructure, and a ring world whole.
 * Command and argument names match `app/src-tauri/src/commands/megastructure.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditResult } from "../generated/EditResult";

/**
 * Delete megastructure row `megastructure` of the open save as one edit, with the modifiers,
 * deposits and owner counters its type's dismantle takes back. Without game data the row goes
 * alone.
 */
export function deleteMegastructure(megastructure: number): Promise<EditResult> {
  return invoke<EditResult>("delete_megastructure", { megastructure });
}

/** Delete every ring world of save system `system` as one edit. */
export function deleteRingWorld(system: number): Promise<EditResult> {
  return invoke<EditResult>("delete_ring_world", { system });
}
