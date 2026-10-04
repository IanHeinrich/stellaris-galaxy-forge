/**
 * Saves, campaigns and scenarios on disk, read without a session.
 * Command and argument names match `app/src-tauri/src/commands/listing.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListings } from "../generated/ScenarioListings";

/** The Stellaris save directories that exist on this machine. */
export function saveDirs(): Promise<string[]> {
  return invoke<string[]>("save_dirs");
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

/** Whether the scenario file at `path` is for Paint a Galaxy, as its listing would say. */
export function scenarioPainted(path: string): Promise<boolean> {
  return invoke<boolean>("scenario_painted", { path });
}

/** The setup screen the save at `path` was started with, read without opening it. */
export function saveDetails(path: string): Promise<GalaxySettings> {
  return invoke<GalaxySettings>("save_details", { path });
}

/** The paths among `paths` that are not a file on disk. */
export function missingPaths(paths: string[]): Promise<string[]> {
  return invoke<string[]>("missing_paths", { paths });
}

/** Every other scenario in the directory of `path`, as file name and header name. */
export function siblingScenarioNames(path: string): Promise<Array<[string, string]>> {
  return invoke<Array<[string, string]>>("sibling_scenario_names", { path });
}

/** True when `path` is under a Steam Cloud directory, where Steam may overwrite the file with its cloud copy. */
export function isCloudSave(path: string): Promise<boolean> {
  return invoke<boolean>("is_cloud_save", { path });
}
