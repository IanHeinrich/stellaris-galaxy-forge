/**
 * Placing an ambient object in a scenario system.
 * Command and argument names match `app/src-tauri/src/commands/ambient_object.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";

/**
 * Calls `add_ambient_object`: an ambient object of type `kind` in system `system`, at `x`, `y`
 * about the system's main star. The command's doc says what it refuses.
 */
export function addAmbientObject(
  system: number,
  kind: string,
  x: number,
  y: number,
): Promise<Added> {
  return invoke<Added>("add_ambient_object", { system, kind, x, y });
}
