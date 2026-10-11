/**
 * What the loaded scripts say about a scenario's systems, and the details of a document's systems.
 * Command and argument names match `app/src-tauri/src/commands/scenario.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ClassRolls } from "../generated/ClassRolls";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystems } from "../generated/SpecialSystems";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemRoll } from "../generated/SystemRoll";
import type { SystemScripts } from "../generated/SystemScripts";

/** Planets, deposits, starbase and fleets of the given systems; unknown ids are skipped. */
export function getSystemDetails(ids: number[]): Promise<SystemDetails[]> {
  return invoke<SystemDetails[]>("get_system_details", { ids });
}

/**
 * Roll `roll` of a scenario system: where each body its details list lands, or placeholder planets
 * inside `within` when the game rolls its planets. Empty on a save.
 */
export function getSystemRoll(id: number, roll: number, within: number): Promise<SystemRoll> {
  return invoke<SystemRoll>("get_system_roll", { id, roll, within });
}

/**
 * What `body` of scenario system `system` rolls once the game gives it `class`, as for a body
 * whose block names that class. Rejects on a save, without game data, and when the body cannot be
 * `class`.
 */
export function getClassRolls(
  system: number,
  body: number,
  className: string,
): Promise<ClassRolls> {
  return invoke<ClassRolls>("get_class_rolls", { system, body, class: className });
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

/** The scripts that reach one scenario system; null on a save, without game data, or for an unknown id. */
export function getSystemScripts(id: number): Promise<SystemScripts | null> {
  return invoke<SystemScripts | null>("get_system_scripts", { id });
}
