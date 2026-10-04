/**
 * The open document's lifecycle: opening, saving, undoing and applying edits.
 * Command and argument names match `app/src-tauri/src/commands/session.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { DocumentKind } from "../generated/DocumentKind";
import type { EditResult } from "../generated/EditResult";
import type { ExportReport } from "../generated/ExportReport";
import type { ExportResult } from "../generated/ExportResult";
import type { GalaxyView } from "../generated/GalaxyView";
import type { Issue } from "../generated/Issue";
import type { Op } from "../generated/Op";
import type { OpenResult } from "../generated/OpenResult";
import type { SaveResult } from "../generated/SaveResult";
import type { ScenarioProfile } from "../generated/ScenarioProfile";

/** Which kind of document the file at `path` holds, read from its bytes, whatever its extension. */
export function documentKind(path: string): Promise<DocumentKind> {
  return invoke<DocumentKind>("document_kind", { path });
}

/** Open a save or a scenario script as the session; emits `sgf://progress` while it loads. */
export function openSave(path: string): Promise<OpenResult> {
  return invoke<OpenResult>("open_save", { path });
}

/** Open the save at `path` as a new, unsaved scenario holding its galaxy; the save is untouched. */
export function openAsScenario(path: string, profile: ScenarioProfile): Promise<OpenResult> {
  return invoke<OpenResult>("open_as_scenario", { path, profile });
}

/** Start an empty, unsaved scenario; `radius` sizes the canvas until systems give it an extent, `coreRadius` is written to the file. */
export function newScenario(
  name: string,
  radius: number,
  coreRadius: number,
  profile: ScenarioProfile,
): Promise<OpenResult> {
  return invoke<OpenResult>("new_scenario", { name, radius, coreRadius, profile });
}

/** Write the open save's galaxy as a scenario script at `path`; the session stays as it is. */
export function exportScenario(path: string, profile: ScenarioProfile): Promise<ExportResult> {
  return invoke<ExportResult>("export_scenario", { path, profile });
}

/** What exporting the open save would report, without writing anything. */
export function previewExport(): Promise<ExportReport> {
  return invoke<ExportReport>("preview_export");
}

/** The open document's galaxy as it stands, its stars drawn as the loaded game data says. */
export function getGalaxy(): Promise<GalaxyView> {
  return invoke<GalaxyView>("get_galaxy");
}

/** Build the details projection so search also finds planets and fleets. */
export function warmDetails(): Promise<Issue[]> {
  return invoke<Issue[]>("warm_details");
}

/** Why `op` would be refused, or null when it would apply; the session is left as it was. */
export function checkOp(op: Op): Promise<string | null> {
  return invoke<string | null>("check_op", { op });
}

/** Apply one edit to the session. Rejects with `SgfError` (kind `op`) when a precondition fails. */
export function applyOp(op: Op): Promise<EditResult> {
  return invoke<EditResult>("apply_op", { op });
}

/** Undo the last edit; resolves null when there is nothing to undo. */
export function undo(): Promise<EditResult | null> {
  return invoke<EditResult | null>("undo");
}

/** Redo the last undone edit; resolves null when there is nothing to redo. */
export function redo(): Promise<EditResult | null> {
  return invoke<EditResult | null>("redo");
}

export function closeSave(): Promise<void> {
  return invoke<void>("close_save");
}

/**
 * Save the session to its current path; emits `sgf://progress` while it writes. Rejects with
 * `SgfError` (kind `changed_on_disk`) when something else wrote the file since it was opened or
 * last saved; `force` writes over it, keeping that version as the backup.
 */
export function save(force = false): Promise<SaveResult> {
  return invoke<SaveResult>("save", { force });
}

/**
 * Save the session to a new path; emits `sgf://progress` while it writes. A path that is the
 * session's own file is refused, and forced, as `save` is.
 */
export function saveAs(path: string, force = false): Promise<SaveResult> {
  return invoke<SaveResult>("save_as", { path, force });
}
