/**
 * Paint a Galaxy's fallen empire zones and empire counts, on an open scenario.
 * Command and argument names match `app/src-tauri/src/commands/paint.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditResult } from "../generated/EditResult";
import type { FeZone } from "../generated/FeZone";

/**
 * One `SetFeZone` entry per system, applied as one `Batch`, that replaces the automatic
 * fallen empire zones with `count` of the Paint a Galaxy mod's candidates, spread across the
 * map; empty when the zones already stand as asked. Zones the user placed stay.
 */
export function feZoneFit(count: number): Promise<Array<[number, FeZone | null]>> {
  return invoke<Array<[number, FeZone | null]>>("fe_zone_fit", { count });
}

/** The most zones `feZoneFit` accepts on the open scenario. */
export function feZoneCandidateCount(): Promise<number> {
  return invoke<number>("fe_zone_candidate_count");
}

/**
 * Link `linked` and no other system to the fallen empire zone `anchor` anchors, as one
 * `SetFeLinks`; empty, the zone goes back to the mod's own rule. Rejects with `SgfError` (kind
 * `op`) when `anchor` anchors no zone.
 */
export function setFeLinks(anchor: number, linked: number[]): Promise<EditResult> {
  return invoke<EditResult>("set_fe_links", { anchor, linked });
}

/**
 * The five empire-count header keys and the values Paint a Galaxy's formulas give the open
 * scenario's seats, for one `SetHeaderKeys`. Rejects with `SgfError` (kind `op`) on a save.
 */
export function headerEmpireCounts(): Promise<Array<[string, string]>> {
  return invoke<Array<[string, string]>>("header_empire_counts");
}
