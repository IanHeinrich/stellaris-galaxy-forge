/**
 * Placing a nebula.
 * Command and argument names match `app/src-tauri/src/commands/nebula.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditResult } from "../generated/EditResult";

/**
 * Add a nebula at (x, y) with `radius` as one edit, named from `seed` out of the save's pool of
 * unused nebula names, else the install's lists when game data is loaded, else "New Nebula",
 * numbered when taken.
 */
export function addNebula(seed: number, x: number, y: number, radius: number): Promise<EditResult> {
  return invoke<EditResult>("add_nebula", { seed, x, y, radius });
}
