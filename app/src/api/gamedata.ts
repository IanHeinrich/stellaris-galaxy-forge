/**
 * The game's own data, read from the user's install at runtime: definitions, localisation and
 * what they make of the open save. Command names and argument names here match
 * `app/src-tauri/src/commands.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { BypassView } from "../generated/BypassView";
import type { CountryTypeView } from "../generated/CountryTypeView";
import type { DepositView } from "../generated/DepositView";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { InitializerView } from "../generated/InitializerView";
import type { MapColor } from "../generated/MapColor";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { ResourceIcon } from "../generated/ResourceIcon";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { ShipSizeView } from "../generated/ShipSizeView";
import type { SpecialSystems } from "../generated/SpecialSystems";
import type { StarClassView } from "../generated/StarClassView";
import type { SystemScripts } from "../generated/SystemScripts";
import type { StarbaseLevelView } from "../generated/StarbaseLevelView";

/**
 * Load the game's definitions, localisation and mods from `installPath` (or the discovered install);
 * emits `sgf://progress` (`discover`, `definitions`, `localisation`, `done`). Rejects with `SgfError`
 * kind `no_install` when no install is found.
 */
export function loadGameData(installPath?: string, language?: string): Promise<GameDataSummary> {
  return invoke<GameDataSummary>("load_game_data", {
    installPath: installPath ?? null,
    language: language ?? null,
  });
}

/** The loaded game data, or null when none is loaded. */
export function gameDataSummary(): Promise<GameDataSummary | null> {
  return invoke<GameDataSummary | null>("game_data_summary");
}

export function unloadGameData(): Promise<void> {
  return invoke<void>("unload_game_data");
}

/** Start the auto-reload watcher again after the breaker paused it; a no-op without game data. */
export function resumeAutoReload(): Promise<void> {
  return invoke<void>("resume_auto_reload");
}

/** The open save's special systems, classified with game data when it is loaded. Rejects when no save is open. */
export function getSpecialSystems(): Promise<SpecialSystems> {
  return invoke<SpecialSystems>("get_special_systems");
}

/** Who owns each scenario system at generation, from the loaded scripts; null on a save or without game data. */
export function getScenarioOwners(): Promise<ScenarioOwners | null> {
  return invoke<ScenarioOwners | null>("get_scenario_owners");
}

/** The wormholes and gateways the initializers and day-one events place; null on a save or without game data. */
export function getScenarioBypasses(): Promise<ScenarioBypasses | null> {
  return invoke<ScenarioBypasses | null>("get_scenario_bypasses");
}

/** Open a game-data file in the shell's editor, or show it in its folder; refused outside the loaded roots. */
export function openScript(path: string, reveal: boolean): Promise<void> {
  return invoke<void>("open_script", { path, reveal });
}

/** Open one of the app's own links in the user's browser; refused for any other URL. */
export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

/** The scripts that reach one scenario system; null on a save, without game data, or for an unknown id. */
export function getSystemScripts(id: number): Promise<SystemScripts | null> {
  return invoke<SystemScripts | null>("get_system_scripts", { id });
}

/** Localised names for `keys`; only the keys that resolved are present. */
export function getNames(keys: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_names", { keys });
}

/** Each templated name as the game shows it; without game data, the save's stand-in. */
export function resolveNames(names: NameTemplate[]): Promise<string[]> {
  return invoke<string[]>("resolve_names", { names });
}

/** Every star class of the loaded game data; empty without it. */
export function getStarClasses(): Promise<StarClassView[]> {
  return invoke<StarClassView[]>("get_star_classes");
}

/** Every deposit definition of the loaded game data; empty without it. */
export function getDeposits(): Promise<DepositView[]> {
  return invoke<DepositView[]>("get_deposits");
}

/** Every bypass kind of the loaded game data with its map icon frame; empty without it. */
export function getBypasses(): Promise<BypassView[]> {
  return invoke<BypassView[]>("get_bypasses");
}

/** Every solar system initializer of the loaded game data; empty without it. */
export function getInitializers(): Promise<InitializerView[]> {
  return invoke<InitializerView[]>("get_initializers");
}

/** Every named map colour of the loaded game data; empty without it. */
export function getMapColors(): Promise<MapColor[]> {
  return invoke<MapColor[]>("get_map_colors");
}

/** Every planet class of the loaded game data; empty without it. */
export function getPlanetClasses(): Promise<PlanetClassView[]> {
  return invoke<PlanetClassView[]>("get_planet_classes");
}

/** Every starbase level of the loaded game data; empty without it. */
export function getStarbaseLevels(): Promise<StarbaseLevelView[]> {
  return invoke<StarbaseLevelView[]>("get_starbase_levels");
}

/** Every ship size of the loaded game data with its map icon key; empty without it. */
export function getShipSizes(): Promise<ShipSizeView[]> {
  return invoke<ShipSizeView[]>("get_ship_sizes");
}

/** Every country type of the loaded game data, sorted by name; empty without it. */
export function getCountryTypes(): Promise<CountryTypeView[]> {
  return invoke<CountryTypeView[]>("get_country_types");
}

export function getResourceIcons(): Promise<ResourceIcon[]> {
  return invoke<ResourceIcon[]>("get_resource_icons");
}
