/** Events the Rust side emits. Names match `app/src-tauri/src/commands/mod.rs` and `commands/update.rs`. */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { Progress } from "../generated/Progress";
import type { UpdateProgress } from "../generated/UpdateProgress";

const PROGRESS_EVENT = "sgf://progress";

const GAME_DATA_CHANGED_EVENT = "sgf://gamedata-changed";

/** Subscribe to load/save progress; resolves to the unsubscribe function. */
export function onProgress(handler: (p: Progress) => void): Promise<UnlistenFn> {
  return listen<Progress>(PROGRESS_EVENT, (e) => handler(e.payload));
}

/** Subscribe to rebuilt registries and to the auto-reload watcher pausing or resuming. */
export function onGameDataChanged(
  handler: (changed: GameDataChanged) => void,
): Promise<UnlistenFn> {
  return listen<GameDataChanged>(GAME_DATA_CHANGED_EVENT, (e) => handler(e.payload));
}

const UPDATE_PROGRESS_EVENT = "sgf://update-progress";

/** Subscribe to the download an install drives; resolves to the unsubscribe function. */
export function onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (e) => handler(e.payload));
}
