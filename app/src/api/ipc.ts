/**
 * Every Tauri command the app calls, in one place. This file is the IPC contract, gathered from
 * one file per Rust command module under `app/src-tauri/src/commands/`; every payload type comes
 * from `src/generated/` (ts-rs, never hand-edited).
 */
import { invoke } from "@tauri-apps/api/core";
import type { ClusterPick } from "../generated/ClusterPick";
import type { ClusterRoll } from "../generated/ClusterRoll";
import type { EditResult } from "../generated/EditResult";
import type { SpecialPick } from "../generated/SpecialPick";
export * from "./addBody";
export * from "./addHabitat";
export * from "./addMegastructure";
export * from "./addRingWorld";
export * from "./megastructure";
export * from "./megastructureFits";
export * from "./addSystem";
export * from "./entity";
export * from "./errors";
export * from "./gamedata";
export * from "./listing";
export * from "./names";
export * from "./nebula";
export * from "./paint";
export * from "./prepare";
export * from "./scenario";
export * from "./session";
export * from "./update";

/**
 * Calls `roll_special_cluster`: the Special menu's cluster `cluster` rolled from `seed` with its
 * home at (x, y), as `addSpecialCluster` adds it from the same arguments. Nothing is written.
 */
export function rollSpecialCluster(
  seed: number,
  x: number,
  y: number,
  cluster: string,
): Promise<ClusterRoll> {
  return invoke<ClusterRoll>("roll_special_cluster", { seed, x, y, cluster });
}

/**
 * Calls `add_special_cluster`: add the cluster `rollSpecialCluster` previews from the same
 * arguments as one edit, with its anomalies, dig sites and megastructures when `extras` (saves
 * only), and a lane for each of `links`: a member's index in the roll and an existing system's
 * id. The command's doc says what it refuses.
 */
export function addSpecialCluster(
  seed: number,
  x: number,
  y: number,
  cluster: string,
  extras: boolean,
  links: Array<[number, number]>,
): Promise<EditResult> {
  return invoke<EditResult>("add_special_cluster", { seed, x, y, cluster, extras, links });
}

/** Calls `get_special_layouts`: the Special menu's layouts with their cards, in a save or a scenario. */
export function getSpecialLayouts(): Promise<SpecialPick[]> {
  return invoke<SpecialPick[]>("get_special_layouts");
}

/** Calls `get_special_clusters`: the Special menu's clusters with their cards, in a save or a scenario. */
export function getSpecialClusters(): Promise<ClusterPick[]> {
  return invoke<ClusterPick[]>("get_special_clusters");
}
