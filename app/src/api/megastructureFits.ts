/**
 * What the Add megastructure dialog offers at a spot of a save system.
 * Command and argument names match `app/src-tauri/src/commands/megastructure_fits.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddSpot } from "../generated/AddSpot";
import type { MegastructureFit } from "../generated/MegastructureFit";

/**
 * Each type that goes at `spot` of system `system` of the open save, with the type Add writes
 * there, where its row stands and why the save would refuse it; see the command for which types
 * go where.
 */
export function getMegastructureFits(system: number, spot: AddSpot): Promise<MegastructureFit[]> {
  return invoke<MegastructureFit[]>("get_megastructure_fits", { system, spot });
}
