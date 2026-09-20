/**
 * The save session: opening a file, reading it back and editing it. Command names and argument
 * names here match `app/src-tauri/src/commands.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { CampaignListing } from "../generated/CampaignListing";
import type { EditResult } from "../generated/EditResult";
import type { EntityAddr } from "../generated/EntityAddr";
import type { EntityKind } from "../generated/EntityKind";
import type { EntitySchema } from "../generated/EntitySchema";
import type { EntitySource } from "../generated/EntitySource";
import type { EntityView } from "../generated/EntityView";
import type { Op } from "../generated/Op";
import type { OpenResult } from "../generated/OpenResult";
import type { SaveFile } from "../generated/SaveFile";
import type { SaveResult } from "../generated/SaveResult";
import type { ScenarioListings } from "../generated/ScenarioListings";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemDetail } from "../generated/SystemDetail";
import type { SystemDetails } from "../generated/SystemDetails";

/** The Stellaris save directories that exist on this machine. */
export function saveDirs(): Promise<string[]> {
  return invoke<string[]>("save_dirs");
}

/** Every `.sav` under the Stellaris save directories on this machine, newest first. */
export function listSaves(): Promise<SaveFile[]> {
  return invoke<SaveFile[]>("list_saves");
}

/** Every campaign folder under the Stellaris save directories, with the header of its newest save. */
export function listCampaigns(): Promise<CampaignListing[]> {
  return invoke<CampaignListing[]>("list_campaigns");
}

/** The saves in one campaign folder, newest first. */
export function listCampaignSaves(dir: string): Promise<SaveFile[]> {
  return invoke<SaveFile[]>("list_campaign_saves", { dir });
}

/** Every static galaxy scenario the install and its mods hold, with what went wrong finding them. */
export function listScenarios(): Promise<ScenarioListings> {
  return invoke<ScenarioListings>("list_scenarios");
}

/** Open a save or a scenario script as the session; emits `sgf://progress` while it loads. */
export function openSave(path: string): Promise<OpenResult> {
  return invoke<OpenResult>("open_save", { path });
}

/** Open the save at `path` as a new, unsaved scenario holding its galaxy; the save is untouched. */
export function openAsScenario(path: string): Promise<OpenResult> {
  return invoke<OpenResult>("open_as_scenario", { path });
}

/** Start an empty, unsaved scenario; `radius` sizes the canvas until systems give it an extent, `coreRadius` is written to the file. */
export function newScenario(name: string, radius: number, coreRadius: number): Promise<OpenResult> {
  return invoke<OpenResult>("new_scenario", { name, radius, coreRadius });
}

/** Write the open save's galaxy as a scenario script at `path`; the session stays as it is. */
export function exportScenario(path: string): Promise<SaveResult> {
  return invoke<SaveResult>("export_scenario", { path });
}

/** One system with its neighbours resolved. Rejects with `SgfError` when no save is open or `id` is unknown. */
export function getSystem(id: number): Promise<SystemDetail> {
  return invoke<SystemDetail>("get_system", { id });
}

/** Systems whose id or name matches `query`, best first, at most `limit`. */
export function search(query: string, limit = 20): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search", { query, limit });
}

/** Build the details projection so search also finds planets and fleets. */
export function warmDetails(): Promise<void> {
  return invoke<void>("warm_details");
}

/** Planets, deposits, starbase and fleets of the given systems; unknown ids are skipped. */
export function getSystemDetails(ids: number[]): Promise<SystemDetails[]> {
  return invoke<SystemDetails[]>("get_system_details", { ids });
}

/** One level of an entity: the children at `path`, each flagged when an op changed it. */
export function getEntity(addr: EntityAddr, path: string[] = []): Promise<EntityView> {
  return invoke<EntityView>("get_entity", { addr, path });
}

/** An entity's current bytes with the ranges an op changed. */
export function getEntitySource(addr: EntityAddr): Promise<EntitySource> {
  return invoke<EntitySource>("get_entity_source", { addr });
}

/** The labelled fields of a kind; keys outside it render raw. */
export function getEntitySchema(kind: EntityKind): Promise<EntitySchema> {
  return invoke<EntitySchema>("get_entity_schema", { kind });
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

/** Save the session to its current path; emits `sgf://progress` while it writes. */
export function save(): Promise<SaveResult> {
  return invoke<SaveResult>("save");
}

/** Save the session to a new path; emits `sgf://progress` while it writes. */
export function saveAs(path: string): Promise<SaveResult> {
  return invoke<SaveResult>("save_as", { path });
}

/** True when `path` is under a Steam Cloud directory, where Steam may overwrite the file with its cloud copy. */
export function isCloudSave(path: string): Promise<boolean> {
  return invoke<boolean>("is_cloud_save", { path });
}
