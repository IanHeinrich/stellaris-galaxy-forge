/**
 * In-app updates: what the endpoint offers, and replacing the running copy with it. Command
 * names here match `app/src-tauri/src/commands/update.rs`.
 */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { UpdateCheck } from "../generated/UpdateCheck";

/** Where a check would send the user, known without one; mirrors `RELEASES_URL` on the Rust side, which allows it. */
export const RELEASES_URL = "https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/latest";

/** Ask the endpoint what it offers, and park what it answers for `installUpdate`. */
export function checkForUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("check_for_update");
}

/**
 * Download the parked update and run it, emitting `sgf://update-progress` as it goes. The
 * installer ends this process on Windows and the app restarts elsewhere, so it normally
 * never resolves; it rejects when the download or the handover fails.
 */
export function installUpdate(): Promise<void> {
  return invoke<void>("install_update");
}

/** The running copy's own version, as its bundle declares it. */
export function appVersion(): Promise<string> {
  return getVersion();
}
